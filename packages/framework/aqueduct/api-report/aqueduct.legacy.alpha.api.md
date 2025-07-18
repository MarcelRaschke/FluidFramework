## Alpha API Report File for "@fluidframework/aqueduct"

> Do not edit this file. It is a report generated by [API Extractor](https://api-extractor.com/).

```ts

// @alpha @legacy
export class BaseContainerRuntimeFactory extends RuntimeFactoryHelper implements IProvideFluidDataStoreRegistry {
    constructor(props: BaseContainerRuntimeFactoryProps);
    protected containerHasInitialized(runtime: IContainerRuntime): Promise<void>;
    protected containerInitializingFirstTime(runtime: IContainerRuntime): Promise<void>;
    get IFluidDataStoreRegistry(): IFluidDataStoreRegistry;
    instantiateFirstTime(runtime: IContainerRuntime): Promise<void>;
    instantiateFromExisting(runtime: IContainerRuntime): Promise<void>;
    preInitialize(context: IContainerContext, existing: boolean): Promise<IContainerRuntime & IRuntime>;
}

// @alpha @legacy
export interface BaseContainerRuntimeFactoryProps {
    // @deprecated (undocumented)
    dependencyContainer?: IFluidDependencySynthesizer;
    minVersionForCollab?: MinimumVersionForCollab | undefined;
    provideEntryPoint: (runtime: IContainerRuntime) => Promise<FluidObject>;
    registryEntries: NamedFluidDataStoreRegistryEntries;
    // @deprecated
    requestHandlers?: RuntimeRequestHandler[];
    runtimeOptions?: IContainerRuntimeOptions;
}

// @alpha @legacy
export class ContainerRuntimeFactoryWithDefaultDataStore extends BaseContainerRuntimeFactory {
    constructor(props: ContainerRuntimeFactoryWithDefaultDataStoreProps);
    protected containerInitializingFirstTime(runtime: IContainerRuntime): Promise<void>;
    // (undocumented)
    static readonly defaultDataStoreId = "default";
    // (undocumented)
    protected readonly defaultFactory: IFluidDataStoreFactory;
}

// @alpha @legacy
export interface ContainerRuntimeFactoryWithDefaultDataStoreProps {
    // (undocumented)
    defaultFactory: IFluidDataStoreFactory;
    // @deprecated (undocumented)
    dependencyContainer?: IFluidDependencySynthesizer;
    provideEntryPoint?: (runtime: IContainerRuntime) => Promise<FluidObject>;
    registryEntries: NamedFluidDataStoreRegistryEntries;
    // @deprecated
    requestHandlers?: RuntimeRequestHandler[];
    runtimeOptions?: IContainerRuntimeOptions;
}

// @alpha @legacy
export abstract class DataObject<I extends DataObjectTypes = DataObjectTypes> extends PureDataObject<I> {
    protected getUninitializedErrorString(item: string): string;
    initializeInternal(existing: boolean): Promise<void>;
    protected get root(): ISharedDirectory;
}

// @alpha @legacy
export class DataObjectFactory<TObj extends DataObject<I>, I extends DataObjectTypes = DataObjectTypes> extends PureDataObjectFactory<TObj, I> {
    constructor(type: string, ctor: new (props: IDataObjectProps<I>) => TObj, sharedObjects?: readonly IChannelFactory[], optionalProviders?: FluidObjectSymbolProvider<I["OptionalProviders"]>, registryEntries?: NamedFluidDataStoreRegistryEntries, runtimeFactory?: typeof FluidDataStoreRuntime);
    constructor(props: DataObjectFactoryProps<TObj, I>);
}

// @alpha @legacy
export interface DataObjectFactoryProps<TObj extends PureDataObject<I>, I extends DataObjectTypes = DataObjectTypes> {
    readonly ctor: new (props: IDataObjectProps<I>) => TObj;
    readonly optionalProviders?: FluidObjectSymbolProvider<I["OptionalProviders"]>;
    readonly policies?: Partial<IFluidDataStorePolicies>;
    readonly registryEntries?: NamedFluidDataStoreRegistryEntries;
    readonly runtimeClass?: typeof FluidDataStoreRuntime;
    readonly sharedObjects?: readonly IChannelFactory[];
    readonly type: string;
}

// @alpha @legacy
export interface DataObjectTypes {
    Events?: IEvent;
    InitialState?: any;
    OptionalProviders?: FluidObject;
}

// @alpha @legacy (undocumented)
export interface IDataObjectProps<I extends DataObjectTypes = DataObjectTypes> {
    // (undocumented)
    readonly context: IFluidDataStoreContext;
    // (undocumented)
    readonly initProps?: I["InitialState"];
    // (undocumented)
    readonly providers: AsyncFluidObjectProvider<I["OptionalProviders"]>;
    // (undocumented)
    readonly runtime: IFluidDataStoreRuntime;
}

// @alpha @legacy
export abstract class PureDataObject<I extends DataObjectTypes = DataObjectTypes> extends TypedEventEmitter<I["Events"] & IEvent> implements IFluidLoadable, IProvideFluidHandle {
    constructor(props: IDataObjectProps<I>);
    protected readonly context: IFluidDataStoreContext;
    finishInitialization(existing: boolean): Promise<void>;
    // (undocumented)
    static getDataObject(runtime: IFluidDataStoreRuntime): Promise<PureDataObject>;
    get handle(): IFluidHandleInternal<this>;
    protected hasInitialized(): Promise<void>;
    // (undocumented)
    get id(): string;
    get IFluidHandle(): IFluidHandleInternal<this>;
    get IFluidLoadable(): this;
    initializeInternal(existing: boolean): Promise<void>;
    protected initializeP: Promise<void> | undefined;
    protected initializingFirstTime(props?: I["InitialState"]): Promise<void>;
    protected initializingFromExisting(): Promise<void>;
    // (undocumented)
    protected initProps?: I["InitialState"];
    protected preInitialize(): Promise<void>;
    protected readonly providers: AsyncFluidObjectProvider<I["OptionalProviders"]>;
    request(req: IRequest): Promise<IResponse>;
    protected readonly runtime: IFluidDataStoreRuntime;
}

// @alpha @legacy
export class PureDataObjectFactory<TObj extends PureDataObject<I>, I extends DataObjectTypes = DataObjectTypes> implements IFluidDataStoreFactory, Partial<IProvideFluidDataStoreRegistry> {
    constructor(type: string, ctor: new (props: IDataObjectProps<I>) => TObj, sharedObjects?: readonly IChannelFactory[], optionalProviders?: FluidObjectSymbolProvider<I["OptionalProviders"]>, registryEntries?: NamedFluidDataStoreRegistryEntries, runtimeClass?: typeof FluidDataStoreRuntime);
    constructor(props: DataObjectFactoryProps<TObj, I>);
    createChildInstance(parentContext: IFluidDataStoreContext, initialState?: I["InitialState"], loadingGroupId?: string): Promise<TObj>;
    createInstance(runtime: IContainerRuntimeBase, initialState?: I["InitialState"], loadingGroupId?: string): Promise<TObj>;
    // (undocumented)
    protected createInstanceCore(context: IFluidDataStoreContextDetached, initialState?: I["InitialState"]): Promise<TObj>;
    createInstanceWithDataStore(containerRuntime: IContainerRuntimeBase, initialState?: I["InitialState"], packagePath?: Readonly<string[]>, loadingGroupId?: string): Promise<[TObj, IDataStore]>;
    // (undocumented)
    protected createNonRootInstanceCore(containerRuntime: IContainerRuntimeBase, packagePath: Readonly<string[]>, initialState?: I["InitialState"], loadingGroupId?: string): Promise<TObj>;
    createPeerInstance(peerContext: IFluidDataStoreContext, initialState?: I["InitialState"], loadingGroupId?: string): Promise<TObj>;
    // @deprecated
    createRootInstance(rootDataStoreId: string, runtime: IContainerRuntime, initialState?: I["InitialState"]): Promise<TObj>;
    get IFluidDataStoreFactory(): this;
    get IFluidDataStoreRegistry(): IFluidDataStoreRegistry | undefined;
    instantiateDataStore(context: IFluidDataStoreContext, existing: boolean): Promise<IFluidDataStoreChannel>;
    get registryEntry(): NamedFluidDataStoreRegistryEntry;
    readonly type: string;
}

// @alpha @legacy
export abstract class TreeDataObject<TDataObjectTypes extends DataObjectTypes = DataObjectTypes> extends PureDataObject<TDataObjectTypes> {
    // (undocumented)
    initializeInternal(existing: boolean): Promise<void>;
    protected get tree(): ITree;
}

// @alpha @legacy
export class TreeDataObjectFactory<TDataObject extends TreeDataObject<TDataObjectTypes>, TDataObjectTypes extends DataObjectTypes = DataObjectTypes> extends PureDataObjectFactory<TDataObject, TDataObjectTypes> {
    constructor(props: DataObjectFactoryProps<TDataObject, TDataObjectTypes>);
}

```
