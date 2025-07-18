/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type { IFluidLoadable } from "@fluidframework/core-interfaces";
import type { ISnapshotTree } from "@fluidframework/driver-definitions/internal";
import type {
	IExperimentalIncrementalSummaryContext,
	IGarbageCollectionData,
	IRuntimeMessageCollection,
	ISummaryTreeWithStats,
	ITelemetryContext,
} from "@fluidframework/runtime-definitions/internal";

import type { IFluidDataStoreRuntime } from "./dataStoreRuntime.js";
import type { IChannelAttributes } from "./storage.js";

/**
 * An object which can be connected to a
 * {@link https://fluidframework.com/docs/concepts/architecture#fluid-service|Fluid service} via an {@link IChannelServices} instance.
 * @remarks
 * This interface exposes functionality that the service requires to create and maintain summaries of the channel.
 * This summary support allows for loading a channel without having to reapply all ops that have been applied during its lifetime.
 * @privateRemarks
 * Since this is an interface between services (which we only expect to be implemented in this repository) and SharedObjects (which we also only expect to be implemented in this repository),
 * this should probably eventually become internal.
 *
 * {@link IChannelView} subsets this interface removing APIs only needed by the service: if/when IChannel becomes internal, it may make sense to reverse the dependency between these two interfaces,
 * and promote {@link IChannelView} to expose its APIs more publicly.
 *
 * TODO:
 * Either Channels should become a useful well documented abstraction of which there could be another implementation, or it should be better integrated with SharedObject to reduce concept count.
 *
 * @legacy
 * @alpha
 */
export interface IChannel extends IFluidLoadable {
	/**
	 * A readonly identifier for the channel
	 */
	readonly id: string;

	readonly attributes: IChannelAttributes;

	/**
	 * Generates summary of the channel synchronously. It is called when an `attach message`
	 * for a local channel is generated. In other words, when the channel is being attached
	 * to make it visible to other clients.
	 *
	 * @remarks
	 *
	 * Note: Since the Attach Summary is generated for local channels when making them visible to
	 * remote clients, they don't have any previous summaries to compare against. For this reason,
	 * the attach summary cannot contain summary handles (paths to sub-trees or blobs).
	 * It can, however, contain {@link @fluidframework/protocol-definitions#ISummaryAttachment}
	 * (handles to blobs uploaded async via the blob manager).
	 *
	 * @param fullTree - A flag indicating whether the attempt should generate a full
	 * summary tree without any handles for unchanged subtrees.
	 *
	 * Default: `false`
	 *
	 * @param trackState - An optimization for tracking state of objects across summaries. If the state
	 * of an object did not change since last successful summary, an
	 * {@link @fluidframework/protocol-definitions#ISummaryHandle} can be used
	 * instead of re-summarizing it. If this is `false`, the expectation is that you should never
	 * send an `ISummaryHandle`, since you are not expected to track state.
	 *
	 * Note: The goal is to remove the trackState and automatically decided whether the
	 * handles will be used or not: {@link https://github.com/microsoft/FluidFramework/issues/10455}
	 *
	 * Default: `false`
	 *
	 * @param telemetryContext - See {@link @fluidframework/runtime-definitions#ITelemetryContext}.
	 *
	 * @returns A summary capturing the current state of the channel.
	 */
	getAttachSummary(
		fullTree?: boolean,
		trackState?: boolean,
		telemetryContext?: ITelemetryContext,
	): ISummaryTreeWithStats;

	/**
	 * Generates summary of the channel asynchronously.
	 * This should not be called where the channel can be modified while summarization is in progress.
	 *
	 * @param fullTree - flag indicating whether the attempt should generate a full
	 * summary tree without any handles for unchanged subtrees. It should only be set to true when generating
	 * a summary from the entire container.
	 *
	 * Default: `false`
	 *
	 * @param trackState - An optimization for tracking state of objects across summaries. If the state
	 * of an object did not change since last successful summary, an
	 * {@link @fluidframework/protocol-definitions#ISummaryHandle} can be used
	 * instead of re-summarizing it. If this is `false`, the expectation is that you should never
	 * send an `ISummaryHandle`, since you are not expected to track state.
	 *
	 * Default: `false`
	 *
	 * Note: The goal is to remove the trackState and automatically decided whether the
	 * handles will be used or not: {@link https://github.com/microsoft/FluidFramework/issues/10455}
	 *
	 * @param telemetryContext - See {@link @fluidframework/runtime-definitions#ITelemetryContext}.
	 *
	 * @returns A summary capturing the current state of the channel.
	 */
	summarize(
		fullTree?: boolean,
		trackState?: boolean,
		telemetryContext?: ITelemetryContext,
		incrementalSummaryContext?: IExperimentalIncrementalSummaryContext,
	): Promise<ISummaryTreeWithStats>;

	/**
	 * Checks if the channel is attached to storage.
	 * @returns True iff the channel is attached.
	 */
	isAttached(): boolean;

	/**
	 * Enables the channel to send and receive ops.
	 * @param services - The services to connect to.
	 */
	connect(services: IChannelServices): void;

	/**
	 * Returns the GC data for this channel. It contains a list of GC nodes that contains references to
	 * other GC nodes.
	 * @param fullGC - true to bypass optimizations and force full generation of GC data.
	 */
	getGCData(fullGC?: boolean): IGarbageCollectionData;
}

/**
 * Handler provided by shared data structure to process requests from the runtime.
 * @legacy
 * @alpha
 */
export interface IDeltaHandler {
	/**
	 * Process messages for this channel. The messages here are contiguous messages for this channel in a batch.
	 * @param messageCollection - The collection of messages to process.
	 */
	processMessages: (messageCollection: IRuntimeMessageCollection) => void;

	/**
	 * State change events to indicate changes to the delta connection
	 * @param connected - true if connected, false otherwise
	 */
	setConnectionState(connected: boolean): void;

	/**
	 * Called when the runtime asks the client to resubmit an op. This may be because the Container reconnected and
	 * this op was not acked.
	 * The client can choose to resubmit the same message, submit different / multiple messages or not submit anything
	 * at all.
	 * @param message - The original message that was submitted.
	 * @param localOpMetadata - The local metadata associated with the original message.
	 * @param squash - If true, the DDS should avoid resubmitting any "unnecessary intermediate state" created by this message.
	 * This includes any content which this message created but has since been changed or removed by subsequent messages.
	 * For example, if this message (call it A) inserts content into a DDS that a subsequent op (call it B) removes,
	 * resubmission of this message (call it A') should avoid inserting that content, and resubmission of the subsequent op that removed it (B') would
	 * account for the fact that A' never inserted content.
	 */
	// TODO: Use something other than `any` (breaking change)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	reSubmit(message: any, localOpMetadata: unknown, squash?: boolean): void;

	/**
	 * Apply changes from an op just as if a local client has made the change,
	 * including submitting the op. Used when rehydrating an attached container
	 * with pending changes. This prepares the SharedObject for seeing an ACK
	 * for the op or resubmitting the op upon reconnection.
	 * @param content - Contents of a stashed op.
	 * @returns Should return void.
	 *
	 * @privateRemarks
	 * This interface is undergoing changes. Right now it support both the old
	 * flow, where just local metadata is returned, and a more ergonomic flow
	 * where operations are applied just like local edits, including
	 * submission of the op if attached. Soon the old flow will be removed
	 * and only the new flow will be supported.
	 */
	// TODO: Use something other than `any` (breaking change)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	applyStashedOp(message: any): void;

	/**
	 * Revert a local op.
	 * @param message - The original message that was submitted.
	 * @param localOpMetadata - The local metadata associated with the original message.
	 */
	// TODO: Use something other than `any` (breaking change)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	rollback?(message: any, localOpMetadata: unknown): void;
}

/**
 * Interface to represent a connection to a delta notification stream.
 * @legacy
 * @alpha
 */
export interface IDeltaConnection {
	connected: boolean;

	/**
	 * Send new messages to the server.
	 * @param messageContent - The content of the message to be sent.
	 * @param localOpMetadata - The local metadata associated with the message. This is kept locally by the runtime
	 * and not sent to the server. It will be provided back when this message is acknowledged by the server. It will
	 * also be provided back when asked to resubmit the message.
	 */
	// TODO: Use something other than `any` (breaking change)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	submit(messageContent: any, localOpMetadata: unknown): void;

	/**
	 * Attaches a message handler to the delta connection
	 */
	attach(handler: IDeltaHandler): void;

	/**
	 * Indicates that the channel is dirty and needs to be part of the summary. It is called by a SharedSummaryBlock
	 * that needs to be part of the summary but does not generate ops.
	 */
	dirty(): void;
}

/**
 * Storage services to read the objects at a given path.
 * @legacy
 * @alpha
 */
export interface IChannelStorageService {
	/**
	 * Reads the object contained at the given path. Returns a buffer representation for the object.
	 */
	readBlob(path: string): Promise<ArrayBufferLike>;

	/**
	 * Determines if there is an object contained at the given path.
	 */
	contains(path: string): Promise<boolean>;

	/**
	 * Lists the blobs that exist at a specific path.
	 */
	list(path: string): Promise<string[]>;

	/**
	 * Returns the snapshot tree for the channel. This will help channels examine their snapshot when it consists
	 * of dynamic trees and blobs, i.e., the number of tree and blobs and / or their keys are not known in advance.
	 */
	getSnapshotTree?(): ISnapshotTree | undefined;
}

/**
 * Storage services to read the objects at a given path using the given delta connection.
 * @legacy
 * @alpha
 */
export interface IChannelServices {
	deltaConnection: IDeltaConnection;

	objectStorage: IChannelStorageService;
}

/**
 * Definitions of a channel factory.
 *
 * @remarks
 *
 * The runtime must be able to produce "channels" of the correct in-memory object type for the collaborative session.
 * Here "channels" are typically distributed data structures (DDSs).
 *
 * The runtime will consult with a registry of such factories during
 * {@link https://fluidframework.com/docs/build/containers/ | Container} load and when receiving "attach" operations
 * (ops), which indicate a new instance of a channel being introduced to the collaboration session, to produce the
 * appropriate in-memory object.
 *
 * Factories follow a common model but enable custom behavior.
 *
 * @example
 *
 * If a collaboration includes a {@link https://fluidframework.com/docs/data-structures/map/ | SharedMap},
 * the collaborating clients will need to have access to a factory that can produce the `SharedMap` object.
 *
 * @privateRemarks
 * TChannel is intersected with IChannel when returned instead of constrained to it since doing so enables LoadableObjectClass to be covariant over its input parameter.
 * This means that code like fluid-static's `InitialObjects` can be simple and type safe and LoadableObjectClass<any> is not needed.
 * This approach (not requiring TChannel to extend IChannel) also makes it possible for SharedObject's public interfaces to not include IChannel if desired
 * (while still requiring the implementation to implement it).
 *
 * @legacy
 * @alpha
 */
export interface IChannelFactory<out TChannel = unknown> {
	/**
	 * String representing the type of the factory.
	 */
	readonly type: string;

	/**
	 * Attributes of the channel.
	 */
	readonly attributes: IChannelAttributes;

	/**
	 * Loads the given channel. This call is only ever invoked internally as the only thing
	 * that is ever directly loaded is the document itself. Load will then only be called on documents that
	 * were created and added to a channel.
	 * @param runtime - Data store runtime containing state/info/helper methods about the data store.
	 * @param id - ID of the channel.
	 * @param services - Services to read objects at a given path using the delta connection.
	 * @param channelAttributes - The attributes for the the channel to be loaded.
	 * @returns The loaded object
	 *
	 * @privateRemarks
	 * Thought: should the storage object include the version information and limit access to just files
	 * for the given object? The latter seems good in general. But both are probably good things. We then just
	 * need a way to allow the document to provide later storage for the object.
	 */
	load(
		runtime: IFluidDataStoreRuntime,
		id: string,
		services: IChannelServices,
		channelAttributes: Readonly<IChannelAttributes>,
	): Promise<TChannel & IChannel>;

	/**
	 * Creates a local version of the channel.
	 * Calling attach on the object later will insert it into the object stream.
	 * @param runtime - The runtime the new object will be associated with
	 * @param id - The unique ID of the new object
	 * @returns The newly created object.
	 *
	 * @privateRemarks
	 * NOTE here - When we attach we need to submit all the pending ops prior to actually doing the attach
	 * for consistency.
	 */
	create(runtime: IFluidDataStoreRuntime, id: string): TChannel & IChannel;
}
