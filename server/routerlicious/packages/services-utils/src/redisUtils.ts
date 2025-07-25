/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type * as Redis from "ioredis";

/**
 * @internal
 */
export interface IRedisParameters {
	prefix?: string;
	expireAfterSeconds?: number;
}

/**
 * @internal
 */
export const executeRedisMultiWithHmsetExpire = async (
	client: Redis.default | Redis.Cluster,
	key: string,
	data: { [key: string]: any },
	expireAfterSeconds: number,
): Promise<void> =>
	new Promise<void>((resolve, reject) => {
		client
			.multi()
			.hmset(key, data)
			.expire(key, expireAfterSeconds)
			.exec()
			.then((results: any) => {
				// results` is an array of responses corresponding to the sequence of queued commands.
				// In other words, it is [Error | null, any][].
				// Each response follows the format `[err, result]`. `err` refers to runtime errors.

				// Check if any queued command had an error
				for (const result of results) {
					if (result[0] && result[0] instanceof Error) {
						reject(result[0]);
						return;
					}
				}

				// HMSET should return the string OK indicating success. Otherwise, we had an error.
				if (results[0][1] !== "OK") {
					reject(new Error(`Redis HMSET returned unexpected response: ${results[0][1]}`));
					return;
				}

				// EXPIRE should return the number 1 indicating success. Otherwise, we had an error.
				if (results[1][1] !== 1) {
					reject(
						new Error(`Redis EXPIRE returned unexpected response: ${results[0][1]}`),
					);
					return;
				}

				resolve();
			})
			.catch((error) => {
				reject(error);
			});
	});

/**
 * @internal
 */
export const executeRedisMultiWithHmsetExpireAndLpush = async (
	client: Redis.default | Redis.Cluster,
	hKey: string,
	hData: { [key: string]: any },
	lKey: string,
	lData: string,
	expireAfterSeconds: number,
): Promise<void> =>
	new Promise<void>((resolve, reject) => {
		client
			.multi()
			.hmset(hKey, hData)
			.expire(hKey, expireAfterSeconds)
			.lpush(lKey, lData)
			.exec()
			.then((results: any) => {
				// results` is an array of responses corresponding to the sequence of queued commands.
				// In other words, it is [Error | null, any][].
				// Each response follows the format `[err, result]`. `err` refers to runtime errors.

				// Check if any queued command had an error
				for (const result of results) {
					if (result[0] && result[0] instanceof Error) {
						reject(result[0]);
						return;
					}
				}

				// HMSET should return the string OK indicating success. Otherwise, we had an error.
				if (results[0][1] !== "OK") {
					reject(new Error(`Redis HMSET returned unexpected response: ${results[0][1]}`));
					return;
				}

				// EXPIRE should return the number 1 indicating success. Otherwise, we had an error.
				if (results[1][1] !== 1) {
					reject(
						new Error(`Redis EXPIRE returned unexpected response: ${results[1][1]}`),
					);
					return;
				}

				// LPUSH should return the length of the list indicating success. Otherwise, we had an error.
				if (results[2][1] <= 0) {
					reject(new Error(`Redis LPUSH returned unexpected response: ${results[2][1]}`));
					return;
				}

				resolve();
			})
			.catch((error) => {
				reject(error);
			});
	});

export const getRedisClusterRetryStrategy =
	(
		options: { delayPerAttemptMs: number; maxDelayMs: number } = {
			delayPerAttemptMs: 50,
			maxDelayMs: 2000,
		},
	) =>
	(attempts: number) =>
		Math.min(attempts * options.delayPerAttemptMs, options.maxDelayMs);
