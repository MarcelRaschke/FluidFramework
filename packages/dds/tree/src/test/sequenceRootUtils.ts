/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import {
	type TreeStoredSchema,
	rootFieldKey,
	type TreeNodeSchemaIdentifier,
	type JsonableTree,
} from "../core/index.js";
import { FieldKinds } from "../feature-libraries/index.js";
import type { ITreeCheckout, TreeCheckout } from "../shared-tree/index.js";
import { stringSchema, toStoredSchema, normalizeAllowedTypes } from "../simple-tree/index.js";
import { brand, type JsonCompatible } from "../util/index.js";
import { checkoutWithContent, chunkFromJsonableTrees } from "./utils.js";
import { fieldJsonCursor } from "./json/index.js";
import { JsonAsTree } from "../jsonDomainSchema.js";

// This file provides utilities for testing sequence fields using documents where the root is the sequence being tested.
// This pattern is not expressible using the public simple-tree API, and is only for testing internal details.

export const jsonSequenceRootSchema: TreeStoredSchema = {
	nodeSchema: toStoredSchema(JsonAsTree.Tree).nodeSchema,
	rootFieldSchema: {
		kind: FieldKinds.sequence.identifier,
		types: new Set(
			[...normalizeAllowedTypes(JsonAsTree.Tree)].map((s) =>
				brand<TreeNodeSchemaIdentifier>(s.identifier),
			),
		),
		persistedMetadata: undefined,
	},
};

/**
 * Helper function to insert node at a given index.
 *
 * @param tree - The tree on which to perform the insert.
 * @param index - The index in the root field at which to insert.
 * @param value - The value of the inserted nodes.
 */
export function insert(tree: ITreeCheckout, index: number, ...values: string[]): void {
	const fieldEditor = tree.editor.sequenceField({ field: rootFieldKey, parent: undefined });
	fieldEditor.insert(
		index,
		chunkFromJsonableTrees(
			values.map(
				(value): JsonableTree => ({
					type: brand(stringSchema.identifier),
					value,
				}),
			),
		),
	);
}

/**
 * Removes `count` items from the root field of `tree`.
 */
export function remove(tree: ITreeCheckout, index: number, count: number): void {
	const field = tree.editor.sequenceField({ parent: undefined, field: rootFieldKey });
	field.remove(index, count);
}

/**
 * Creates a sequence field at the root.
 */
export function makeTreeFromJsonSequence(json: JsonCompatible[]): TreeCheckout {
	const tree = checkoutWithContent({
		schema: jsonSequenceRootSchema,
		initialTree: fieldJsonCursor(json),
	});
	return tree;
}
