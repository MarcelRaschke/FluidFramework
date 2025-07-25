/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

export type {
	TreeSchema,
	ITreeViewConfiguration,
	ITreeConfigurationOptions,
} from "./configuration.js";
export {
	TreeViewConfiguration,
	TreeViewConfigurationAlpha,
} from "./configuration.js";
export type {
	ITree,
	TreeView,
	ViewableTree,
	TreeViewEvents,
	SchemaCompatibilityStatus,
	TreeViewAlpha,
	TreeBranch,
	TreeBranchEvents,
	ITreeAlpha,
} from "./tree.js";
export { asTreeViewAlpha } from "./tree.js";
export {
	SchemaFactory,
	type ScopedSchemaName,
	type SchemaFactoryObjectOptions,
	type SchemaStatics,
	schemaStatics,
	type NodeSchemaOptions,
	type NodeSchemaOptionsAlpha,
} from "./schemaFactory.js";
export { SchemaFactoryAlpha } from "./schemaFactoryAlpha.js";
export type {
	ValidateRecursiveSchema,
	FixRecursiveArraySchema,
	ValidateRecursiveSchemaTemplate,
	FixRecursiveRecursionLimit,
} from "./schemaFactoryRecursive.js";
export { allowUnused } from "./schemaFactoryRecursive.js";
export {
	adaptEnum,
	enumFromStrings,
	singletonSchema,
} from "./schemaCreationUtilities.js";
export {
	getIdentifierFromNode,
	getPropertyKeyFromStoredKey,
	getStoredKey,
	treeNodeApi,
	type TreeNodeApi,
	tryGetSchema,
} from "./treeNodeApi.js";
export { createFromCursor } from "./create.js";
export {
	type JsonSchemaId,
	type JsonSchemaType,
	type JsonObjectNodeSchema,
	type JsonArrayNodeSchema,
	type JsonMapNodeSchema,
	type JsonLeafNodeSchema,
	type JsonSchemaRef,
	type JsonRefPath,
	type JsonNodeSchema,
	type JsonNodeSchemaBase,
	type JsonTreeSchema,
	type JsonFieldSchema,
	type JsonLeafSchemaType,
	type JsonRecordNodeSchema,
	type JsonStringKeyPatternProperties,
} from "./jsonSchema.js";
export type { TreeSchemaEncodingOptions } from "./getJsonSchema.js";
export { getJsonSchema } from "./getJsonSchema.js";
export { getSimpleSchema } from "./getSimpleSchema.js";
export { SchemaCompatibilityTester } from "./schemaCompatibilityTester.js";
export type {
	Unenforced,
	FieldSchemaAlphaUnsafe,
	ArrayNodeCustomizableSchemaUnsafe,
	MapNodeCustomizableSchemaUnsafe,
	System_Unsafe,
	TreeRecordNodeUnsafe,
} from "./typesUnsafe.js";

export {
	type VerboseTreeNode,
	type VerboseTree,
	applySchemaToParserOptions,
	cursorFromVerbose,
	verboseFromCursor,
	replaceVerboseTreeHandles,
} from "./verboseTree.js";

export {
	type TreeEncodingOptions,
	customFromCursorStored,
	type CustomTreeNode,
	type CustomTreeValue,
	tryStoredSchemaAsArray,
	replaceHandles,
	type HandleConverter,
} from "./customTree.js";

export {
	type ConciseTree,
	conciseFromCursor,
	replaceConciseTreeHandles,
} from "./conciseTree.js";

export { TreeBeta, type NodeChangedData, type TreeChangeEventsBeta } from "./treeBeta.js";
export { createSimpleTreeIndex, type SimpleTreeIndex } from "./simpleTreeIndex.js";
export {
	createIdentifierIndex,
	type IdentifierIndex,
} from "./identifierIndex.js";

export {
	extractPersistedSchema,
	comparePersistedSchema,
} from "./storedSchema.js";

export {
	type TransactionConstraint,
	type NodeInDocumentConstraint,
	type RunTransactionParams,
	type VoidTransactionCallbackStatus,
	type TransactionCallbackStatus,
	type TransactionResult,
	type TransactionResultExt,
	type TransactionResultSuccess,
	type TransactionResultFailed,
	rollback,
} from "./transactionTypes.js";

export { generateSchemaFromSimpleSchema } from "./schemaFromSimple.js";
export { toSimpleTreeSchema } from "./viewSchemaToSimpleSchema.js";
export type { TreeChangeEvents } from "./treeChangeEvents.js";
