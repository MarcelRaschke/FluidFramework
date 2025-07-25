/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import {
	BaseContainerRuntimeFactory,
	DataObject,
	DataObjectFactory,
} from "@fluidframework/aqueduct/internal";
import type { IRuntimeFactory } from "@fluidframework/container-definitions/internal";
import {
	FluidDataStoreRegistry,
	type IContainerRuntimeOptions,
	type MinimumVersionForCollab,
} from "@fluidframework/container-runtime/internal";
import type {
	IContainerRuntime,
	IContainerRuntimeInternal,
} from "@fluidframework/container-runtime-definitions/internal";
import type {
	FluidObject,
	IFluidHandle,
	IFluidLoadable,
} from "@fluidframework/core-interfaces";
import { assert } from "@fluidframework/core-utils/internal";
import type { IChannelFactory } from "@fluidframework/datastore-definitions/internal";
import type { IDirectory } from "@fluidframework/map/internal";
import type { IFluidDataStoreRegistry } from "@fluidframework/runtime-definitions/internal";
import type { SharedObjectKind } from "@fluidframework/shared-object-base/internal";

import { compatibilityModeRuntimeOptions } from "./compatibilityConfiguration.js";
import type {
	CompatibilityMode,
	ContainerSchema,
	IRootDataObject,
	IStaticEntryPoint,
	LoadableObjectKind,
	LoadableObjectKindRecord,
	LoadableObjectRecord,
} from "./types.js";
import {
	compatibilityModeToMinVersionForCollab,
	createDataObject,
	createSharedObject,
	isDataObjectKind,
	isSharedObjectKind,
	makeFluidObject,
	parseDataObjectsFromSharedObjects,
} from "./utils.js";

/**
 * Input props for {@link RootDataObject.initializingFirstTime}.
 */
interface RootDataObjectProps {
	/**
	 * Initial object structure with which the {@link RootDataObject} will be first-time initialized.
	 *
	 * @see {@link RootDataObject.initializingFirstTime}
	 */
	readonly initialObjects: LoadableObjectKindRecord;
}

interface IProvideRootDataObject {
	readonly RootDataObject: RootDataObject;
}

/**
 * The entry-point/root collaborative object of the {@link IFluidContainer | Fluid Container}.
 * Abstracts the dynamic code required to build a Fluid Container into a static representation for end customers.
 */
class RootDataObject
	extends DataObject<{ InitialState: RootDataObjectProps }>
	implements IRootDataObject, IProvideRootDataObject
{
	private readonly initialObjectsDirKey = "initial-objects-key";
	private readonly _initialObjects: LoadableObjectRecord = {};

	public get RootDataObject(): RootDataObject {
		return this;
	}

	private get initialObjectsDir(): IDirectory {
		const dir = this.root.getSubDirectory(this.initialObjectsDirKey);
		if (dir === undefined) {
			throw new Error("InitialObjects sub-directory was not initialized");
		}
		return dir;
	}

	/**
	 * The first time this object is initialized, creates each object identified in
	 * {@link RootDataObjectProps.initialObjects} and stores them as unique values in the root directory.
	 *
	 * @see {@link @fluidframework/aqueduct#PureDataObject.initializingFirstTime}
	 */
	protected async initializingFirstTime(props: RootDataObjectProps): Promise<void> {
		this.root.createSubDirectory(this.initialObjectsDirKey);

		// Create initial objects provided by the developer
		const initialObjectsP: Promise<void>[] = [];
		for (const [id, objectClass] of Object.entries(props.initialObjects)) {
			const createObject = async (): Promise<void> => {
				const obj = await this.create<IFluidLoadable>(
					objectClass as SharedObjectKind<IFluidLoadable>,
				);
				this.initialObjectsDir.set(id, obj.handle);
			};
			initialObjectsP.push(createObject());
		}

		await Promise.all(initialObjectsP);
	}

	/**
	 * Every time an instance is initialized, loads all of the initial objects in the root directory so they can be
	 * accessed immediately.
	 *
	 * @see {@link @fluidframework/aqueduct#PureDataObject.hasInitialized}
	 */
	protected async hasInitialized(): Promise<void> {
		// We will always load the initial objects so they are available to the developer
		const loadInitialObjectsP: Promise<void>[] = [];
		for (const [key, value] of this.initialObjectsDir.entries()) {
			const loadDir = async (): Promise<void> => {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
				const obj: unknown = await value.get();
				Object.assign(this._initialObjects, { [key]: obj });
			};
			loadInitialObjectsP.push(loadDir());
		}

		await Promise.all(loadInitialObjectsP);
	}

	public get initialObjects(): LoadableObjectRecord {
		if (Object.keys(this._initialObjects).length === 0) {
			throw new Error("Initial Objects were not correctly initialized");
		}
		return this._initialObjects;
	}

	public async create<T>(objectClass: SharedObjectKind<T>): Promise<T> {
		const internal = objectClass as unknown as LoadableObjectKind<T & IFluidLoadable>;
		if (isDataObjectKind(internal)) {
			return createDataObject(internal, this.context);
		} else if (isSharedObjectKind(internal)) {
			return createSharedObject(internal, this.runtime);
		}
		throw new Error("Could not create new Fluid object because an unknown object was passed");
	}

	public async uploadBlob(blob: ArrayBufferLike): Promise<IFluidHandle<ArrayBufferLike>> {
		return this.runtime.uploadBlob(blob);
	}
}

const rootDataStoreId = "rootDOId";
const rootDataObjectType = "rootDO";

async function provideEntryPoint(
	containerRuntime: IContainerRuntime,
): Promise<IStaticEntryPoint> {
	const entryPoint = await containerRuntime.getAliasedDataStoreEntryPoint(rootDataStoreId);
	if (entryPoint === undefined) {
		throw new Error(`default dataStore [${rootDataStoreId}] must exist`);
	}
	const rootDataObject = ((await entryPoint.get()) as FluidObject<RootDataObject>)
		.RootDataObject;
	assert(rootDataObject !== undefined, 0xb9f /* entryPoint must be of type RootDataObject */);
	return makeFluidObject<IStaticEntryPoint>(
		{
			rootDataObject,
			extensionStore: containerRuntime as IContainerRuntimeInternal,
		},
		"IStaticEntryPoint",
	);
}

/**
 * Creates an {@link @fluidframework/aqueduct#IRuntimeFactory} which constructs containers
 * with an entry point containing single directory-based root data object.
 *
 * @remarks
 * The entry point is opaque to caller.
 * The root data object's registry and initial objects are configured based on the provided
 * schema (and optionally, data store registry).
 *
 * @internal
 */
export function createDOProviderContainerRuntimeFactory(props: {
	/**
	 * The schema for the container.
	 */
	schema: ContainerSchema;
	/**
	 * See {@link CompatibilityMode} and compatibilityModeRuntimeOptions for more details.
	 */
	compatibilityMode: CompatibilityMode;
	/**
	 * Optional registry of data stores to pass to the DataObject factory.
	 * If not provided, one will be created based on the schema.
	 */
	rootDataStoreRegistry?: IFluidDataStoreRegistry;
	/**
	 * Optional overrides for the container runtime options.
	 * If not provided, only the default options for the given compatibilityMode will be used.
	 */
	runtimeOptionOverrides?: Partial<IContainerRuntimeOptions>;
	/**
	 * Optional override for minimum version for collab.
	 * If not provided, the default for the given compatibilityMode will be used.
	 * @remarks
	 * This is useful when runtime options are overridden and change the minimum version for collab.
	 */
	minVersionForCollabOverride?: MinimumVersionForCollab;
}): IRuntimeFactory {
	const {
		compatibilityMode,
		minVersionForCollabOverride,
		rootDataStoreRegistry,
		runtimeOptionOverrides,
		schema,
	} = props;
	const [registryEntries, sharedObjects] = parseDataObjectsFromSharedObjects(schema);
	const registry = rootDataStoreRegistry ?? new FluidDataStoreRegistry(registryEntries);

	return new DOProviderContainerRuntimeFactory(
		schema,
		compatibilityMode,
		new RootDataObjectFactory(sharedObjects, registry),
		{
			runtimeOptions: runtimeOptionOverrides,
			minVersionForCollab: minVersionForCollabOverride,
		},
	);
}

/**
 * Factory for Container Runtime instances that provide a {@link IStaticEntryPoint}
 * (containing single {@link IRootDataObject}) as their entry point.
 */
class DOProviderContainerRuntimeFactory extends BaseContainerRuntimeFactory {
	private readonly rootDataObjectFactory: DataObjectFactory<
		RootDataObject,
		{
			InitialState: RootDataObjectProps;
		}
	>;

	private readonly initialObjects: LoadableObjectKindRecord;

	/**
	 * Create a new instance of a container runtime factory.
	 * @remarks
	 * The caller is responsible for making sure that the provided root data object factory is configured
	 * appropriately based on the schema of the container (e.g. its registry entries contain all the
	 * DataStore/DDS types that the schema says can be constructed).
	 *
	 * Most scenarios probably want to use {@link createDOProviderContainerRuntimeFactory} instead,
	 * since it can take care of constructing the root data object factory based on the schema.
	 *
	 * @param schema - The schema for the container
	 * @param compatibilityMode - Compatibility mode
	 * @param rootDataObjectFactory - A factory that can construct the root data object.
	 */
	public constructor(
		schema: ContainerSchema,
		compatibilityMode: CompatibilityMode,
		rootDataObjectFactory: DataObjectFactory<
			RootDataObject,
			{ InitialState: RootDataObjectProps }
		>,
		overrides?: Partial<{
			runtimeOptions: Partial<IContainerRuntimeOptions>;
			minVersionForCollab: MinimumVersionForCollab;
		}>,
	) {
		super({
			registryEntries: [rootDataObjectFactory.registryEntry],
			runtimeOptions: {
				...compatibilityModeRuntimeOptions[compatibilityMode],
				...overrides?.runtimeOptions,
			},
			provideEntryPoint,
			minVersionForCollab:
				overrides?.minVersionForCollab ??
				compatibilityModeToMinVersionForCollab[compatibilityMode],
		});
		this.rootDataObjectFactory = rootDataObjectFactory;
		this.initialObjects = schema.initialObjects;
	}

	protected async containerInitializingFirstTime(runtime: IContainerRuntime): Promise<void> {
		// The first time we create the container we create the RootDataObject
		await this.rootDataObjectFactory.createRootInstance(rootDataStoreId, runtime, {
			initialObjects: this.initialObjects,
		});
	}
}

/**
 * Factory that creates instances of a root data object.
 */
class RootDataObjectFactory extends DataObjectFactory<
	RootDataObject,
	{ InitialState: RootDataObjectProps }
> {
	public constructor(
		sharedObjects: readonly IChannelFactory[] = [],
		private readonly dataStoreRegistry: IFluidDataStoreRegistry,
	) {
		// Note: we're passing `undefined` registry entries to the base class so it won't create a registry itself,
		// and instead we override the necessary methods in this class to use the registry received in the constructor.
		super({
			type: rootDataObjectType,
			ctor: RootDataObject,
			sharedObjects,
		});
	}

	public get IFluidDataStoreRegistry(): IFluidDataStoreRegistry {
		return this.dataStoreRegistry;
	}
}
