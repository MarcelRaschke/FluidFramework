/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import type { IUser, ScopeType } from "@fluidframework/protocol-definitions";
import type { IGitManager } from "@fluidframework/server-services-client";

/**
 * @internal
 */
export interface ITenantConfig {
	id: string;

	storage: ITenantStorage;

	orderer: ITenantOrderer;

	customData: ITenantCustomData;

	/**
	 * Indicates if (not-shared secret) key access is enabled for this tenant.
	 */
	enablePrivateKeyAccess: boolean;

	/**
	 * Indicates if (shared secret) key access is enabled for this tenant.
	 */
	enableSharedKeyAccess: boolean;

	// Timestamp of when this tenant will be hard deleted.
	// The tenant is soft deleted if a deletion timestamp is present.
	scheduledDeletionTime?: string;
}

/**
 * @internal
 */
export interface ITenantStorage {
	// External URL to Historian outside of the cluster
	historianUrl: string;

	// Internal URL to Historian within the cluster
	internalHistorianUrl: string;

	// URL to the storage provider
	url: string;

	// Storage provider owner
	owner: string;

	// Storage provider repository
	repository: string;

	// Access credentials to the storage provider
	credentials: {
		// User accessing the storage provider
		user: string;

		// Password for the storage provider
		password: string;
	};
}

/**
 * @internal
 */
export interface ITenantOrderer {
	// URL to the ordering service
	url: string;

	// The type of ordering service
	type: string;
}

/**
 * @internal
 */
export interface ITenantCustomData {
	[key: string]: any;
}

/**
 * @internal
 */
export interface ITenantKeys {
	key1: string;
	key2: string;
}

export interface IPlainTextAndEncryptedTenantKeys extends ITenantKeys {
	encryptedTenantKey1: string;
	encryptedTenantKey2: string;
}

/**
 * @internal
 */
export enum KeyName {
	key1 = "key1",
	key2 = "key2",
}

// This is tenantEncryptionKey version by year, it's append only.
// We will add a new version each year.
/**
 * @internal
 */
export enum EncryptionKeyVersion {
	key2022 = "2022",
	key2023 = "2023",
	key2024 = "2024",
	key2025 = "2025",
	key2026 = "2026",
}

/**
 * @internal
 */
export interface IEncryptedTenantKeys extends ITenantKeys {
	encryptionKeyVersion?: EncryptionKeyVersion;
}

/**
 * @internal
 */
export interface ITenant {
	gitManager: IGitManager;

	storage: ITenantStorage;

	orderer: ITenantOrderer;
}

// Key maps to the Enum Key1 and secondaryKey maps to the Enum Key2
export interface ITenantPrivateKeys {
	key: string;
	secondaryKey: string;
	// Time in seconds when the key will be rotated
	keyNextRotationTime: number;
	// Time in seconds when the secondary key will be rotated
	secondaryKeyNextRotationTime: number;
}

export interface IEncryptedPrivateTenantKeys extends ITenantPrivateKeys {
	encryptionKeyVersion?: EncryptionKeyVersion;
}

/**
 * @internal
 */
export interface ITenantManager {
	/**
	 * Creates a new tenant with the given id, or a randomly generated id when none is provided.
	 */
	createTenant(tenantId?: string): Promise<ITenantConfig & { key: string }>;

	/**
	 * Retrieves details for the given tenant
	 */
	getTenant(tenantId: string, documentId: string): Promise<ITenant>;

	/**
	 * Retrieves GitManager instance for the given tenant
	 */
	getTenantGitManager(
		tenantId: string,
		documentId: string,
		storageName?: string,
		includeDisabledTenant?: boolean,
		isEphemeralContainer?: boolean,
	): Promise<IGitManager>;

	/**
	 * Verifies that the given auth token is valid. A rejected promise indicates an invalid token.
	 */
	verifyToken(tenantId: string, token: string): Promise<void>;

	/**
	 * Retrieves the key for the given tenant. This is a privileged op and should be used with care.
	 */
	getKey(tenantId: string, includeDisabledTenant?: boolean): Promise<string>;

	/**
	 * Signs an access token for the given tenant. This is a privileged op and should be used with care.
	 */
	signToken(
		tenantId: string,
		documentId: string,
		scopes: ScopeType[],
		user?: IUser,
		lifetime?: number,
		ver?: string,
		jti?: string,
		includeDisabledTenant?: boolean,
	): Promise<string>;
}

/**
 * @internal
 */
export interface ITenantConfigManager {
	getTenantStorageName(tenantId: string): Promise<string>;
}

export interface IInvalidTokenError {
	// The error code to be cached
	code: number;

	// The error message to be cached
	message: string;
}
