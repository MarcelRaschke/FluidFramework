/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { globals } from "../jest.config.cjs";

describe("todo-list", () => {
	beforeAll(async () => {
		// Wait for the page to load first before running any tests
		// so this time isn't attributed to the first test
		await page.goto(globals.PATH, { waitUntil: "load", timeout: 0 });
		await page.waitForFunction(() => (window as any).fluidStarted as unknown);
	}, 45000);

	beforeEach(async () => {
		await page.goto(globals.PATH, { waitUntil: "load" });
		await page.waitForFunction(() => (window as any).fluidStarted as unknown);
	});

	it("loads and there's a button with + for adding new to-do items", async () => {
		// Validate there is a button that can be clicked
		await expect(page).toClick("button", { text: "+" });
	});
});
