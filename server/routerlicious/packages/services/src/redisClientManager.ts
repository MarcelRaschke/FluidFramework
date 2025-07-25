/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type { IClient, ISignalClient } from "@fluidframework/protocol-definitions";
import type { IClientManager, ISequencedSignalClient } from "@fluidframework/server-services-core";
import {
	executeRedisMultiWithHmsetExpire,
	type IRedisParameters,
	type IRedisClientConnectionManager,
} from "@fluidframework/server-services-utils";

// Manages the set of connected clients in redis hashes with an expiry of 'expireAfterSeconds'.
/**
 * @internal
 */
export class ClientManager implements IClientManager {
	private readonly expireAfterSeconds: number = 60 * 60 * 24;
	private readonly prefix: string = "client";

	constructor(
		private readonly redisClientConnectionManager: IRedisClientConnectionManager,
		parameters?: IRedisParameters,
	) {
		if (parameters?.expireAfterSeconds) {
			this.expireAfterSeconds = parameters.expireAfterSeconds;
		}

		if (parameters?.prefix) {
			this.prefix = parameters.prefix;
		}

		redisClientConnectionManager.addErrorHandler(
			undefined, // lumber properties
			"Client Manager Redis Error", // error message
		);
	}

	public async addClient(
		tenantId: string,
		documentId: string,
		clientId: string,
		details: IClient,
	): Promise<void> {
		const key = this.getKey(tenantId, documentId);
		const data: { [key: string]: any } = { [clientId]: JSON.stringify(details) };
		return executeRedisMultiWithHmsetExpire(
			this.redisClientConnectionManager.getRedisClient(),
			key,
			data,
			this.expireAfterSeconds,
		);
	}

	public async removeClient(
		tenantId: string,
		documentId: string,
		clientId: string,
	): Promise<void> {
		await this.redisClientConnectionManager
			.getRedisClient()
			.hdel(this.getKey(tenantId, documentId), clientId);
	}

	public async getClients(tenantId: string, documentId: string): Promise<ISignalClient[]> {
		const dbClients = await this.redisClientConnectionManager
			.getRedisClient()
			.hgetall(this.getKey(tenantId, documentId));
		const clients: ISignalClient[] = [];
		if (dbClients) {
			for (const clientId of Object.keys(dbClients)) {
				clients.push({
					clientId,
					client: JSON.parse(dbClients[clientId]),
				});
			}
		}
		return clients;
	}

	/**
	 * Returns all clients currently connected including a keep alive time.
	 * Should be used with delis read only client functionality.
	 */
	public async getSequencedClients(
		tenantId: string,
		documentId: string,
	): Promise<Map<string, ISequencedSignalClient>> {
		throw new Error("Not implemented");
	}

	/**
	 * Called when the expiration time of clients should be extended.
	 * @param clientTimeout - Amount of time in milliseconds to add to the clients expiration time.
	 */
	public async extendSequencedClients(
		tenantId: string,
		documentId: string,
		clients: Map<string, ISequencedSignalClient>,
		clientTimeout: number,
	): Promise<void> {
		throw new Error("Not implemented");
	}

	private getKey(tenantId: string, documentId: string): string {
		return `${this.prefix}:${tenantId}:${documentId}`;
	}
}
