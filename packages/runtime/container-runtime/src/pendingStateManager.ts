/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { IDisposable, type ITelemetryBaseLogger } from "@fluidframework/core-interfaces";
import { assert, Lazy } from "@fluidframework/core-utils/internal";
import {
	ITelemetryLoggerExt,
	DataProcessingError,
	LoggingError,
	extractSafePropertiesFromMessage,
	createChildLogger,
} from "@fluidframework/telemetry-utils/internal";
import Deque from "double-ended-queue";
import { v4 as uuid } from "uuid";

import { isContainerMessageDirtyable } from "./containerRuntime.js";
import {
	type InboundContainerRuntimeMessage,
	type InboundSequencedContainerRuntimeMessage,
	type LocalContainerRuntimeMessage,
} from "./messageTypes.js";
import { asBatchMetadata, asEmptyBatchLocalOpMetadata } from "./metadata.js";
import {
	EmptyGroupedBatch,
	LocalBatchMessage,
	getEffectiveBatchId,
	BatchStartInfo,
	InboundMessageResult,
	serializeOp,
	type LocalEmptyBatchPlaceholder,
	type BatchResubmitInfo,
} from "./opLifecycle/index.js";

/**
 * This represents a message that has been submitted and is added to the pending queue when `submit` is called on the
 * ContainerRuntime. This message has either not been ack'd by the server or has not been submitted to the server yet.
 *
 * @remarks This is the current serialization format for pending local state when a Container is serialized.
 */
export interface IPendingMessage {
	type: "message";
	referenceSequenceNumber: number;
	/**
	 * Serialized copy of runtimeOp
	 */
	content: string;
	/**
	 * The original runtime op that was submitted to the ContainerRuntime
	 * Unless this pending message came from stashed content, in which case this is undefined at first and then deserialized from the contents string
	 */
	runtimeOp: LocalContainerRuntimeMessage | EmptyGroupedBatch | undefined; // Undefined for initial messages before parsing
	/**
	 * Local Op Metadata that was passed to the ContainerRuntime when the op was submitted.
	 * This contains state needed when processing the ack, or to resubmit or rollback the op.
	 */
	localOpMetadata: unknown;
	/**
	 * Metadata that was passed to the ContainerRuntime when the op was submitted.
	 * This is rarely used, and may be inspected by the service (as opposed to op contents which is opaque)
	 */
	opMetadata: Record<string, unknown> | undefined;
	/**
	 * Populated upon processing the op's ack, before moving the pending message to savedOps.
	 */
	sequenceNumber?: number;
	/**
	 * Info about the batch this pending message belongs to, for validation and for computing the batchId on reconnect
	 * We don't include batchId itself to avoid redundancy, because that's stamped on opMetadata above
	 */
	batchInfo: {
		/**
		 * The Batch's original clientId, from when it was first flushed to be submitted.
		 * Or, a random uuid if it was never submitted (and batchStartCsn will be -1)
		 */
		clientId: string;
		/**
		 * The Batch's original clientSequenceNumber, from when it was first flushed to be submitted
		 * Or, -1 if it was never submitted (and clientId will be a random uuid)
		 */
		batchStartCsn: number;
		/**
		 * length of the batch (how many runtime messages here)
		 */
		length: number;
		/**
		 * If true, don't compare batchID of incoming batches to this. e.g. ID Allocation Batch IDs should be ignored
		 */
		ignoreBatchId?: boolean;
		/**
		 * If true, this batch is staged and should not actually be submitted on replayPendingStates.
		 */
		staged: boolean;
	};
}

type Patch<T, U> = U & Omit<T, keyof U>;

/**
 * First version of the type (pre-dates batchInfo)
 */
type IPendingMessageV0 = Patch<IPendingMessage, { batchInfo?: undefined }>;

/**
 * Union of all supported schemas for when applying stashed ops
 *
 * @remarks When the format changes, this type should update to reflect all possible schemas.
 */
type IPendingMessageFromStash = IPendingMessageV0 | IPendingMessage;

export interface IPendingLocalState {
	/**
	 * list of pending states, including ops and batch information
	 */
	pendingStates: IPendingMessage[];
}

/**
 * Info needed to replay/resubmit a pending message
 */
export type PendingMessageResubmitData = Pick<
	IPendingMessage,
	"runtimeOp" | "localOpMetadata" | "opMetadata"
> & {
	// Required (it's only missing on IPendingMessage for empty batch, which will be resubmitted as an empty array)
	runtimeOp: LocalContainerRuntimeMessage;
};

export interface PendingBatchResubmitMetadata extends BatchResubmitInfo {
	/**
	 * Whether changes in this batch should be squashed when resubmitting.
	 */
	squash: boolean;
}

export interface IRuntimeStateHandler {
	connected(): boolean;
	clientId(): string | undefined;
	applyStashedOp(serializedOp: string): Promise<unknown>;
	reSubmitBatch(
		batch: PendingMessageResubmitData[],
		metadata: PendingBatchResubmitMetadata,
	): void;
	isActiveConnection: () => boolean;
	isAttached: () => boolean;
}

function isEmptyBatchPendingMessage(message: IPendingMessageFromStash): boolean {
	const content = JSON.parse(message.content) as Partial<EmptyGroupedBatch>;
	return content.type === "groupedBatch" && content.contents?.length === 0;
}

function buildPendingMessageContent(message: InboundSequencedContainerRuntimeMessage): string {
	// IMPORTANT: Order matters here, this must match the order of the properties used
	// when submitting the message.
	const { type, contents }: InboundContainerRuntimeMessage = message;
	// Any properties that are not defined, won't be emitted by stringify.
	return JSON.stringify({ type, contents });
}

function typesOfKeys<T extends object>(obj: T): Record<keyof T, string> {
	return Object.keys(obj).reduce((acc, key) => {
		acc[key] = typeof obj[key];
		return acc;
	}, {}) as Record<keyof T, string>;
}

function scrubAndStringify(
	message: InboundContainerRuntimeMessage | LocalContainerRuntimeMessage,
): string {
	// Scrub the whole object in case there are unexpected keys
	const scrubbed: Record<string, unknown> = typesOfKeys(message);

	// For these known/expected keys, we can either drill into the object (for contents)
	// or just use the value as-is (since it's not personal info)
	scrubbed.contents = message.contents && typesOfKeys(message.contents);
	scrubbed.type = message.type;

	return JSON.stringify(scrubbed);
}

/**
 * Finds and returns the index where the strings diverge, and the character at that index in each string (or undefined if not applicable)
 */
function findFirstRawCharacterMismatched(
	a: string,
	b: string,
): [index: number, charA?: string, charB?: string] {
	const minLength = Math.min(a.length, b.length);
	for (let i = 0; i < minLength; i++) {
		if (a[i] !== b[i]) {
			return [i, a[i], b[i]];
		}
	}

	// Since we didn't return in the loop, the shorter string must be a prefix of the other.
	// If they're the same length, return -1 to indicate they're identical.
	// Otherwise, the next character of the longer one is where they differ. No need to return that next character.
	return a.length === b.length
		? [-1, undefined, undefined]
		: [minLength, a[minLength], b[minLength]];
}

/**
 * Finds and returns the index where the strings diverge, and the character at that index in each string (or undefined if not applicable)
 * It scrubs non-ASCII characters since they convey more meaning (privacy consideration)
 */
export function findFirstCharacterMismatched(
	a: string,
	b: string,
): [index: number, charA?: string, charB?: string] {
	const [index, rawCharA, rawCharB] = findFirstRawCharacterMismatched(a, b);

	const charA = (rawCharA?.codePointAt(0) ?? 0) <= 0x7f ? rawCharA : "[non-ASCII]";
	const charB = (rawCharB?.codePointAt(0) ?? 0) <= 0x7f ? rawCharB : "[non-ASCII]";

	return [index, charA, charB];
}

/**
 * Returns a shallow copy of the given message with the non-serializable properties removed.
 * Note that the runtimeOp's data has already been serialized in the content property.
 */
function toSerializableForm(
	message: IPendingMessage,
): IPendingMessage & { runtimeOp: undefined; localOpMetadata: undefined } {
	return {
		...message,
		localOpMetadata: undefined,
		runtimeOp: undefined,
	};
}

interface ReplayPendingStateOptions {
	/**
	 * If true, only replay staged batches, clearing the "staged" flag.
	 * This is used when we are exiting staging mode and want to rebase and submit the staged batches without resubmitting pre-staged messages.
	 * Default: false
	 */
	committingStagedBatches: boolean;
	/**
	 * @param squash - If true, edits should be squashed when resubmitting.
	 * Default: false
	 */
	squash: boolean;
}

const defaultReplayPendingStatesOptions: ReplayPendingStateOptions = {
	committingStagedBatches: false,
	squash: false,
};

/**
 * PendingStateManager is responsible for maintaining the messages that have not been sent or have not yet been
 * acknowledged by the server. It also maintains the batch information for both automatically and manually flushed
 * batches along with the messages.
 * When the Container reconnects, it replays the pending states, which includes manual flushing
 * of messages and triggering resubmission of unacked ops.
 *
 * It verifies that all the ops are acked, are received in the right order and batch information is correct.
 */
export class PendingStateManager implements IDisposable {
	/**
	 * Messages that will need to be resubmitted if not ack'd before the next reconnection
	 */
	private readonly pendingMessages = new Deque<IPendingMessage>();
	/**
	 * Messages stashed from a previous container, now being rehydrated. Need to be resubmitted.
	 */
	private readonly initialMessages = new Deque<IPendingMessageFromStash>();

	/**
	 * Sequenced local ops that are saved when stashing since pending ops may depend on them
	 */
	private savedOps: IPendingMessage[] = [];

	// eslint-disable-next-line unicorn/consistent-function-scoping -- Property is defined once; no need to extract inner lambda
	private readonly disposeOnce = new Lazy<void>(() => {
		this.initialMessages.clear();
		this.pendingMessages.clear();
	});

	/**
	 * Used to ensure we don't replay ops on the same connection twice
	 */
	private clientIdFromLastReplay: string | undefined;

	/**
	 * The pending messages count. Includes `pendingMessages` and `initialMessages` to keep in sync with
	 * 'hasPendingMessages'.
	 */
	public get pendingMessagesCount(): number {
		return this.pendingMessages.length + this.initialMessages.length;
	}

	/**
	 * Checks the pending messages to see if any of them represent user changes (aka "dirtyable" messages)
	 */
	public hasPendingUserChanges(): boolean {
		for (let i = 0; i < this.pendingMessages.length; i++) {
			const element = this.pendingMessages.get(i);
			if (
				element !== undefined &&
				hasTypicalRuntimeOp(element) && // Empty batches don't count towards user changes
				isContainerMessageDirtyable(element.runtimeOp)
			) {
				return true;
			}
		}
		// Consider any initial messages to be user changes
		// (it's an approximation since we would have to parse them to know for sure)
		return this.initialMessages.length > 0;
	}

	/**
	 * The minimumPendingMessageSequenceNumber is the minimum of the first pending message and the first initial message.
	 *
	 * We need this so that we can properly keep local data and maintain the correct sequence window.
	 */
	public get minimumPendingMessageSequenceNumber(): number | undefined {
		return this.pendingMessages.peekFront()?.referenceSequenceNumber;
	}

	/**
	 * Called to check if there are any pending messages in the pending message queue.
	 * @returns A boolean indicating whether there are messages or not.
	 */
	public hasPendingMessages(): boolean {
		return this.pendingMessagesCount !== 0;
	}

	public getLocalState(snapshotSequenceNumber?: number): IPendingLocalState {
		assert(
			this.initialMessages.isEmpty(),
			0x2e9 /* "Must call getLocalState() after applying initial states" */,
		);
		// Using snapshot sequence number to filter ops older than our latest snapshot.
		// Such ops should not be declared in pending/stashed state. Snapshot seq num will not
		// be available when the container is not attached. Therefore, no filtering is needed.
		const newSavedOps = [...this.savedOps].filter((message) => {
			assert(
				message.sequenceNumber !== undefined,
				0x97c /* saved op should already have a sequence number */,
			);
			return message.sequenceNumber > (snapshotSequenceNumber ?? 0);
		});
		for (const message of this.pendingMessages.toArray()) {
			if (
				snapshotSequenceNumber !== undefined &&
				message.referenceSequenceNumber < snapshotSequenceNumber
			) {
				throw new LoggingError("trying to stash ops older than our latest snapshot");
			}
		}
		return {
			pendingStates: [
				...newSavedOps,
				...this.pendingMessages.toArray().map((message) => toSerializableForm(message)),
			],
		};
	}

	private readonly logger: ITelemetryLoggerExt;

	constructor(
		private readonly stateHandler: IRuntimeStateHandler,
		stashedLocalState: IPendingLocalState | undefined,
		logger: ITelemetryBaseLogger,
	) {
		this.logger = createChildLogger({ logger });
		if (stashedLocalState?.pendingStates) {
			this.initialMessages.push(...stashedLocalState.pendingStates);
		}
	}

	public get disposed(): boolean {
		return this.disposeOnce.evaluated;
	}
	public readonly dispose = (): void => this.disposeOnce.value;

	/**
	 * We've flushed an empty batch, and need to track it locally until the corresponding
	 * ack is processed, to properly track batch IDs
	 */
	public onFlushEmptyBatch(
		placeholder: LocalEmptyBatchPlaceholder,
		clientSequenceNumber: number | undefined,
		staged: boolean,
	): void {
		this.onFlushBatch([placeholder], clientSequenceNumber, staged);
	}

	/**
	 * The given batch has been flushed, and needs to be tracked locally until the corresponding
	 * acks are processed, to ensure it is successfully sent.
	 * @param batch - The batch that was flushed
	 * @param clientSequenceNumber - The CSN of the first message in the batch,
	 * or undefined if the batch was not yet sent (e.g. by the time we flushed we lost the connection)
	 * @param staged - Indicates whether batch is staged (not to be submitted while runtime is in Staging Mode)
	 * @param ignoreBatchId - Whether to ignore the batchId in the batchStartInfo
	 */
	public onFlushBatch(
		batch: LocalBatchMessage[] | [LocalEmptyBatchPlaceholder],
		clientSequenceNumber: number | undefined,
		staged: boolean,
		ignoreBatchId?: boolean,
	): void {
		// clientId and batchStartCsn are used for generating the batchId so we can detect container forks
		// where this batch was submitted by two different clients rehydrating from the same local state.
		// In the typical case where the batch was actually sent, use the clientId and clientSequenceNumber.
		// In the case where the batch was not sent, use a random uuid for clientId, and -1 for clientSequenceNumber to indicate this case.
		// This will guarantee uniqueness of the batchId, and is a suitable fallback since clientId/CSN is only needed if the batch was actually sent/sequenced.
		const batchWasSent = clientSequenceNumber !== undefined;
		if (batchWasSent) {
			assert(!staged, 0xb84 /* Staged batches should not have been submitted */);
		}
		const [clientId, batchStartCsn] = batchWasSent
			? [this.stateHandler.clientId(), clientSequenceNumber]
			: [uuid(), -1]; // -1 will indicate not a real clientId/CSN pair
		assert(
			clientId !== undefined,
			0xa33 /* clientId (from stateHandler) could only be undefined if we've never connected, but we have a CSN so we know that's not the case */,
		);

		for (const message of batch) {
			const {
				runtimeOp,
				referenceSequenceNumber,
				localOpMetadata,
				metadata: opMetadata,
			} = message;
			const pendingMessage: IPendingMessage = {
				type: "message",
				referenceSequenceNumber,
				content: serializeOp(runtimeOp),
				runtimeOp,
				localOpMetadata,
				opMetadata,
				// Note: We only will read this off the first message, but put it on all for simplicity
				batchInfo: { clientId, batchStartCsn, length: batch.length, ignoreBatchId, staged },
			};
			this.pendingMessages.push(pendingMessage);
		}
	}

	/**
	 * Applies stashed ops at their reference sequence number so they are ready to be ACKed or resubmitted
	 * @param seqNum - Sequence number at which to apply ops. Will apply all ops if seqNum is undefined.
	 */
	public async applyStashedOpsAt(seqNum?: number): Promise<void> {
		// apply stashed ops at sequence number
		while (!this.initialMessages.isEmpty()) {
			if (seqNum !== undefined) {
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				const peekMessage = this.initialMessages.peekFront()!;
				if (peekMessage.referenceSequenceNumber > seqNum) {
					break; // nothing left to do at this sequence number
				}
				if (peekMessage.referenceSequenceNumber < seqNum) {
					throw new Error("loaded from snapshot too recent to apply stashed ops");
				}
			}
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			const nextMessage = this.initialMessages.shift()!;
			// Nothing to apply if the message is an empty batch.
			// We still need to track it for resubmission.
			try {
				if (isEmptyBatchPendingMessage(nextMessage)) {
					nextMessage.localOpMetadata = {
						emptyBatch: true,
					} satisfies LocalEmptyBatchPlaceholder["localOpMetadata"]; // equivalent to applyStashedOp for empty batch
					patchbatchInfo(nextMessage); // Back compat
					this.pendingMessages.push(nextMessage);
					continue;
				}
				// applyStashedOp will cause the DDS to behave as if it has sent the op but not actually send it
				const localOpMetadata = await this.stateHandler.applyStashedOp(nextMessage.content);
				if (this.stateHandler.isAttached()) {
					nextMessage.localOpMetadata = localOpMetadata;
					// NOTE: This runtimeOp has been roundtripped through string, which is technically lossy.
					// e.g. At this point, handles are in their encoded form.
					nextMessage.runtimeOp = JSON.parse(
						nextMessage.content,
					) as LocalContainerRuntimeMessage;
					// then we push onto pendingMessages which will cause PendingStateManager to resubmit when we connect
					patchbatchInfo(nextMessage); // Back compat
					this.pendingMessages.push(nextMessage);
				} else {
					if (localOpMetadata !== undefined) {
						throw new Error("Local Op Metadata must be undefined when not attached");
					}
				}
			} catch (error) {
				throw DataProcessingError.wrapIfUnrecognized(error, "applyStashedOp", nextMessage);
			}
		}
	}

	/**
	 * Compares the batch ID of the incoming batch with the pending batch ID for this client.
	 * They should not match, as that would indicate a forked container.
	 * @param remoteBatchStart - BatchStartInfo for an incoming batch *NOT* submitted by this client
	 * @returns whether the batch IDs match
	 */
	private remoteBatchMatchesPendingBatch(remoteBatchStart: BatchStartInfo): boolean {
		// Find the first pending message that uses Batch ID, to compare to the incoming remote batch.
		// If there is no such message, then the incoming remote batch doesn't have a match here and we can return.
		const firstIndexUsingBatchId = Array.from({
			length: this.pendingMessages.length,
		}).findIndex((_, i) => this.pendingMessages.get(i)?.batchInfo.ignoreBatchId !== true);
		const pendingMessageUsingBatchId =
			firstIndexUsingBatchId === -1
				? undefined
				: this.pendingMessages.get(firstIndexUsingBatchId);

		if (pendingMessageUsingBatchId === undefined) {
			return false;
		}

		// We must compare the effective batch IDs, since one of these ops
		// may have been the original, not resubmitted, so wouldn't have its batch ID stamped yet.
		const pendingBatchId = getEffectiveBatchId(pendingMessageUsingBatchId);
		const inboundBatchId = getEffectiveBatchId(remoteBatchStart);

		return pendingBatchId === inboundBatchId;
	}

	/**
	 * Processes an inbound message or batch of messages - May be local or remote.
	 *
	 * @param inbound - The inbound message(s) to process, with extra info (e.g. about the start of a batch). Could be local or remote.
	 * @param local - true if we submitted these messages and expect corresponding pending messages
	 * @returns The inbound messages with localOpMetadata "zipped" in.
	 *
	 * @throws a DataProcessingError in either of these cases:
	 * - The pending message content doesn't match the incoming message content for any message here
	 * - The batch IDs *do match* but it's not local (indicates Container forking).
	 */
	public processInboundMessages(
		inbound: InboundMessageResult,
		local: boolean,
	): {
		message: InboundSequencedContainerRuntimeMessage;
		localOpMetadata?: unknown;
	}[] {
		if (local) {
			return this.processPendingLocalMessages(inbound);
		}

		// An inbound remote batch should not match the pending batch ID for this client.
		// That would indicate the container forked (two instances trying to submit the same local state)
		if ("batchStart" in inbound && this.remoteBatchMatchesPendingBatch(inbound.batchStart)) {
			throw DataProcessingError.create(
				"Forked Container Error! Matching batchIds but mismatched clientId",
				"PendingStateManager.processInboundMessages",
				inbound.batchStart.keyMessage,
			);
		}

		// No localOpMetadata for remote messages
		const messages = inbound.type === "fullBatch" ? inbound.messages : [inbound.nextMessage];
		return messages.map((message) => ({ message }));
	}

	/**
	 * Processes the incoming message(s) from the server that were submitted by this client.
	 * It verifies that messages are received in the right order and that any batch information is correct.
	 * @param inbound - The inbound message(s) (originating from this client) to correlate with the pending local state
	 * @throws DataProcessingError if the pending message content doesn't match the incoming message content for any message here
	 * @returns The inbound messages with localOpMetadata "zipped" in.
	 */
	private processPendingLocalMessages(inbound: InboundMessageResult): {
		message: InboundSequencedContainerRuntimeMessage;
		localOpMetadata: unknown;
	}[] {
		if ("batchStart" in inbound) {
			this.onLocalBatchBegin(inbound.batchStart, inbound.length);
		}

		// Empty batch
		if (inbound.length === 0) {
			const localOpMetadata = this.processNextPendingMessage(
				inbound.batchStart.keyMessage.sequenceNumber,
			);
			assert(
				asEmptyBatchLocalOpMetadata(localOpMetadata)?.emptyBatch === true,
				0xa20 /* Expected empty batch marker */,
			);
			return [];
		}

		const messages = inbound.type === "fullBatch" ? inbound.messages : [inbound.nextMessage];

		return messages.map((message) => ({
			message,
			localOpMetadata: this.processNextPendingMessage(message.sequenceNumber, message),
		}));
	}

	/**
	 * Processes the pending local copy of message that's been ack'd by the server.
	 * @param sequenceNumber - The sequenceNumber from the server corresponding to the next pending message.
	 * @param message - [optional] The entire incoming message, for comparing contents with the pending message for extra validation.
	 * @throws DataProcessingError if the pending message content doesn't match the incoming message content.
	 * @returns - The localOpMetadata of the next pending message, to be sent to whoever submitted the original message.
	 */
	private processNextPendingMessage(
		sequenceNumber: number,
		message?: InboundSequencedContainerRuntimeMessage,
	): unknown {
		const pendingMessage = this.pendingMessages.peekFront();
		assert(
			pendingMessage !== undefined,
			0x169 /* "No pending message found for this remote message" */,
		);

		pendingMessage.sequenceNumber = sequenceNumber;
		this.savedOps.push(toSerializableForm(pendingMessage));

		this.pendingMessages.shift();

		// message is undefined in the Empty Batch case,
		// because we don't have an incoming message to compare and pendingMessage is just a placeholder anyway.
		if (message !== undefined) {
			const messageContent = buildPendingMessageContent(message);

			// Stringified content should match
			// If it doesn't, collect as much info about the difference as possible (privacy-wise) and log it
			if (pendingMessage.content !== messageContent) {
				const [pendingLength, incomingLength] = [
					pendingMessage.content.length,
					messageContent.length,
				];
				const [mismatchStartIndex, pendingChar, incomingChar] = findFirstCharacterMismatched(
					pendingMessage.content,
					messageContent,
				);

				const pendingContentObj = JSON.parse(
					pendingMessage.content,
				) as LocalContainerRuntimeMessage;
				const incomingContentObj = JSON.parse(
					messageContent,
				) as InboundContainerRuntimeMessage;

				// Compare inner contents object, since that both should be { type, contents }
				const contentsMatch =
					pendingContentObj.contents === incomingContentObj.contents ||
					(pendingContentObj.contents !== undefined &&
						incomingContentObj.contents !== undefined &&
						JSON.stringify(pendingContentObj.contents) ===
							JSON.stringify(incomingContentObj.contents));

				this.logger.sendErrorEvent({
					eventName: "unexpectedAckReceived",
					details: {
						pendingContentScrubbed: scrubAndStringify(pendingContentObj),
						incomingContentScrubbed: scrubAndStringify(incomingContentObj),
						contentsMatch,
						pendingLength,
						incomingLength,
						mismatchStartIndex,
						pendingChar,
						incomingChar,
					},
				});

				throw DataProcessingError.create(
					"pending local message content mismatch",
					"unexpectedAckReceived",
					message,
				);
			}
		}

		return pendingMessage.localOpMetadata;
	}

	/**
	 * Check if the incoming batch matches the batch info for the next pending message.
	 */
	private onLocalBatchBegin(batchStart: BatchStartInfo, batchLength?: number): void {
		// Get the next message from the pending queue. Verify a message exists.
		const pendingMessage = this.pendingMessages.peekFront();
		assert(
			pendingMessage !== undefined,
			0xa21 /* No pending message found as we start processing this remote batch */,
		);
		assert(
			!pendingMessage.batchInfo.staged,
			0xb85 /* Pending state mismatch, ack came in but next pending message is staged */,
		);

		// If this batch became empty on resubmit, batch.messages will be empty (but keyMessage is always set)
		// and the next pending message should be an empty batch marker.
		// More Info: We must submit empty batches and track them in case a different fork
		// of this container also submitted the same batch (and it may not be empty for that fork).
		const firstMessage = batchStart.keyMessage;
		// -1 length is for back compat, undefined length means we actually don't know it
		const skipLengthCheck =
			pendingMessage.batchInfo.length === -1 || batchLength === undefined;
		const expectedPendingBatchLength =
			batchLength === 0
				? 1 // For an empty batch, expect a singleton array with the empty batch marker
				: batchLength; // Otherwise, the lengths should actually match

		// Note: We don't need to use getEffectiveBatchId here, just check the explicit stamped batchID
		// That logic is needed only when comparing across potential container forks.
		// Furthermore, we also are comparing the batch IDs constituent data - clientId (it's local) and batchStartCsn.
		const pendingBatchId = asBatchMetadata(pendingMessage.opMetadata)?.batchId;
		const inboundBatchId = batchStart.batchId;

		// We expect the incoming batch to be of the same length, starting at the same clientSequenceNumber,
		// as the batch we originally submitted. The batchIds should match as well, if set (or neither should be set)
		// We have another later check to compare the message contents, which we'd expect to fail if this check does,
		// so we don't throw here, merely log.  In a later release this check may replace that one since it's cheaper.
		if (
			pendingMessage.batchInfo.batchStartCsn !== batchStart.batchStartCsn ||
			(!skipLengthCheck && pendingMessage.batchInfo.length !== expectedPendingBatchLength) ||
			pendingBatchId !== inboundBatchId
		) {
			this.logger?.sendErrorEvent({
				eventName: "BatchInfoMismatch",
				details: {
					pendingBatchCsn: pendingMessage.batchInfo.batchStartCsn,
					batchStartCsn: batchStart.batchStartCsn,
					pendingBatchLength: pendingMessage.batchInfo.length,
					expectedPendingBatchLength,
					batchLength,
					pendingBatchId,
					inboundBatchId,
					pendingMessageBatchMetadata: asBatchMetadata(pendingMessage.opMetadata)?.batch,
					messageBatchMetadata: asBatchMetadata(firstMessage?.metadata)?.batch,
				},
				messageDetails: firstMessage && extractSafePropertiesFromMessage(firstMessage),
			});
		}
	}

	/**
	 * Called when the Container's connection state changes. If the Container gets connected, it replays all the pending
	 * states in its queue. This includes triggering resubmission of unacked ops.
	 * ! Note: successfully resubmitting an op that has been successfully sequenced is not possible due to checks in the ConnectionStateHandler (Loader layer)
	 */
	public replayPendingStates(options?: ReplayPendingStateOptions): void {
		const { committingStagedBatches, squash } = {
			...defaultReplayPendingStatesOptions,
			...options,
		};
		assert(
			this.stateHandler.connected() || committingStagedBatches === true,
			0x172 /* "The connection state is not consistent with the runtime" */,
		);

		// Staged batches have not yet been submitted so check doesn't apply
		if (!committingStagedBatches) {
			// This assert suggests we are about to send same ops twice, which will result in data loss.
			assert(
				this.clientIdFromLastReplay !== this.stateHandler.clientId(),
				0x173 /* "replayPendingStates called twice for same clientId!" */,
			);
		}
		this.clientIdFromLastReplay = this.stateHandler.clientId();

		assert(
			this.initialMessages.isEmpty(),
			0x174 /* "initial states should be empty before replaying pending" */,
		);

		const initialPendingMessagesCount = this.pendingMessages.length;
		let remainingPendingMessagesCount = this.pendingMessages.length;

		let seenStagedBatch = false;

		// Process exactly `pendingMessagesCount` items in the queue as it represents the number of messages that were
		// pending when we connected. This is important because the `reSubmitFn` might add more items in the queue
		// which must not be replayed.
		while (remainingPendingMessagesCount > 0) {
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			let pendingMessage = this.pendingMessages.shift()!;
			remainingPendingMessagesCount--;

			// Re-queue pre-staging messages - we are only to replay staged batches
			if (committingStagedBatches) {
				if (!pendingMessage.batchInfo.staged) {
					assert(!seenStagedBatch, 0xb86 /* Staged batch was followed by non-staged batch */);
					this.pendingMessages.push(pendingMessage);
					continue;
				}

				seenStagedBatch = true;
				pendingMessage.batchInfo.staged = false; // Clear staged flag so we can submit
			}

			const batchMetadataFlag = asBatchMetadata(pendingMessage.opMetadata)?.batch;
			assert(batchMetadataFlag !== false, 0x41b /* We cannot process batches in chunks */);

			// The next message starts a batch (possibly single-message), and we'll need its batchId.
			const batchId = pendingMessage.batchInfo.ignoreBatchId
				? undefined
				: getEffectiveBatchId(pendingMessage);

			const staged = pendingMessage.batchInfo.staged;

			if (asEmptyBatchLocalOpMetadata(pendingMessage.localOpMetadata)?.emptyBatch === true) {
				// Resubmit no messages, with the batchId. Will result in another empty batch marker.
				this.stateHandler.reSubmitBatch([], { batchId, staged, squash });
				continue;
			}

			assert(
				hasTypicalRuntimeOp(pendingMessage),
				0xb87 /* runtimeOp is only undefined for empty batches */,
			);

			/**
			 * We must preserve the distinct batches on resubmit.
			 * Note: It is not possible for the PendingStateManager to receive a partially acked batch. It will
			 * either receive the whole batch ack or nothing at all. See {@link InboundBatchAggregator} for how this works.
			 */
			if (batchMetadataFlag === undefined) {
				// Single-message batch

				this.stateHandler.reSubmitBatch(
					[
						{
							runtimeOp: pendingMessage.runtimeOp,
							localOpMetadata: pendingMessage.localOpMetadata,
							opMetadata: pendingMessage.opMetadata,
						},
					],
					{ batchId, staged, squash },
				);
				continue;
			}
			// else: batchMetadataFlag === true  (It's a typical multi-message batch)

			assert(
				remainingPendingMessagesCount > 0,
				0x554 /* Last pending message cannot be a batch begin */,
			);

			const batch: PendingMessageResubmitData[] = [];

			// check is >= because batch end may be last pending message
			while (remainingPendingMessagesCount >= 0) {
				assert(
					hasTypicalRuntimeOp(pendingMessage),
					0xb88 /* runtimeOp is only undefined for empty batches */,
				);
				batch.push({
					runtimeOp: pendingMessage.runtimeOp,
					localOpMetadata: pendingMessage.localOpMetadata,
					opMetadata: pendingMessage.opMetadata,
				});

				// End of the batch
				if (pendingMessage.opMetadata?.batch === false) {
					break;
				}
				assert(remainingPendingMessagesCount > 0, 0x555 /* No batch end found */);

				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				pendingMessage = this.pendingMessages.shift()!;
				remainingPendingMessagesCount--;
				assert(
					pendingMessage.opMetadata?.batch !== true,
					0x556 /* Batch start needs a corresponding batch end */,
				);
			}

			this.stateHandler.reSubmitBatch(batch, { batchId, staged, squash });
		}

		// pending ops should no longer depend on previous sequenced local ops after resubmit
		this.savedOps = [];

		// We replayPendingStates on read connections too - we expect these to get nack'd though, and to then reconnect
		// on a write connection and replay again. This filters out the replay that happens on the read connection so
		// we only see the replays on write connections (that have a chance to go through).
		if (this.stateHandler.isActiveConnection()) {
			this.logger?.sendTelemetryEvent({
				eventName: "PendingStatesReplayed",
				count: initialPendingMessagesCount,
				clientId: this.stateHandler.clientId(),
			});
		}
	}

	/**
	 * Pops all staged batches, invoking the callback on each constituent op in order (LIFO)
	 */
	public popStagedBatches(
		callback: (
			// callback will only be given staged messages with a valid runtime op (i.e. not empty batch and not an initial message with only serialized content)
			stagedMessage: IPendingMessage & { runtimeOp: LocalContainerRuntimeMessage },
		) => void,
	): void {
		while (!this.pendingMessages.isEmpty()) {
			const stagedMessage = this.pendingMessages.peekBack();
			if (stagedMessage?.batchInfo.staged === true) {
				this.pendingMessages.pop();

				if (hasTypicalRuntimeOp(stagedMessage)) {
					callback(stagedMessage);
				}
			} else {
				break; // no more staged messages
			}
		}
		assert(
			this.pendingMessages.toArray().every((m) => m.batchInfo.staged !== true),
			0xb89 /* Shouldn't be any more staged messages */,
		);
	}
}

/**
 * For back-compat if trying to apply stashed ops that pre-date batchInfo
 */
function patchbatchInfo(
	message: IPendingMessageFromStash,
): asserts message is IPendingMessage {
	const batchInfo: IPendingMessageFromStash["batchInfo"] = message.batchInfo;
	if (batchInfo === undefined) {
		// Using uuid guarantees uniqueness, retaining existing behavior
		message.batchInfo = { clientId: uuid(), batchStartCsn: -1, length: -1, staged: false };
	}
}

/**
 * This filters out messages that are not "typical" runtime ops, i.e. empty batches or initial messages (which only have serialized content).
 */
function hasTypicalRuntimeOp(
	message: IPendingMessage,
): message is IPendingMessage & { runtimeOp: LocalContainerRuntimeMessage } {
	return message.runtimeOp !== undefined && message.runtimeOp.type !== "groupedBatch";
}
