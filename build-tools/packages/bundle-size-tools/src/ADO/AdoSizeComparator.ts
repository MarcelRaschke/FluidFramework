/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { join } from "path";
import type { WebApi } from "azure-devops-node-api";
import { BuildResult, BuildStatus } from "azure-devops-node-api/interfaces/BuildInterfaces";
import type JSZip from "jszip";

import type { BundleComparison, BundleComparisonResult } from "../BundleBuddyTypes";
import { compareBundles } from "../compareBundles";
import { getBaselineCommit, getBuilds, getPriorCommit } from "../utilities";
import {
	getBundlePathsFromZipObject,
	getStatsFileFromZip,
	getZipObjectFromArtifact,
} from "./AdoArtifactFileProvider";
import type { IADOConstants } from "./Constants";
import { DefaultStatsProcessors } from "./DefaultStatsProcessors";
import {
	getBundleBuddyConfigFromFileSystem,
	getBundlePathsFromFileSystem,
	getStatsFileFromFileSystem,
} from "./FileSystemBundleFileProvider";
import { getBuildTagForCommit } from "./getBuildTagForCommit";
import { getBundleBuddyConfigMap } from "./getBundleBuddyConfigMap";
import { getBundleSummaries } from "./getBundleSummaries";
import { getCommentForBundleDiff, getSimpleComment } from "./getCommentForBundleDiff";

export class ADOSizeComparator {
	/**
	 * The default number of most recent builds on the ADO pipeline to search when
	 * looking for a build matching a baseline commit, and the default number of
	 * fallback commits returned by the provided default fallback generator.  The
	 * most recent builds may not necessarily match the chain of commits, but
	 * typically will when the pipeline only builds commits to main.
	 */
	private static readonly defaultBuildsToSearch = 20;

	constructor(
		/**
		 * ADO constants identifying where to fetch baseline bundle info
		 */
		private readonly adoConstants: IADOConstants,
		/**
		 * The ADO connection to use to fetch baseline bundle info
		 */
		private readonly adoConnection: WebApi,
		/**
		 * Path to existing local bundle size reports
		 */
		private readonly localReportPath: string,
		/**
		 * Optional current PR build id to use, such as to tag for
		 * later update when the baseline build has not completed
		 */
		private readonly adoBuildId: number | undefined,
		/**
		 * Option to do fallback on commits when either there is no associated CI build or
		 * it does not have the needed artifacts.  Fallback is not attempted for other
		 * issues, such as for a failed (but still present) CI build.  This generator is
		 * only used for fallback (it should not provide the first commit to check)
		 */
		private readonly getFallbackCommit:
			| ((startingCommit: string) => Generator<string>)
			| undefined = undefined,
	) {}

	/**
	 * Naive fallback generator provided for convenience.  It yields the commit directly
	 * prior to the previous commit.
	 */
	public static *naiveFallbackCommitGenerator(startingCommit: string): Generator<string> {
		let currentCommit = startingCommit;
		for (let i = 0; i < ADOSizeComparator.defaultBuildsToSearch; i++) {
			currentCommit = getPriorCommit(currentCommit);
			yield currentCommit;
		}
	}

	/**
	 * Create a size comparison message that can be posted to a PR
	 * @param tagWaiting - If the build should be tagged to be updated when the baseline
	 * build completes (if it wasn't already complete when the comparison runs)
	 * @returns The size comparison result with formatted message and raw data.  In case
	 * of failure, the message contains the error message and the raw data will be undefined.
	 */
	public async createSizeComparisonMessage(
		tagWaiting: boolean,
	): Promise<BundleComparisonResult> {
		let baselineCommit: string | undefined = getBaselineCommit();
		console.log(`The baseline commit for this PR is ${baselineCommit}`);

		// Some circumstances may want us to try a fallback, such as when a commit does
		// not trigger any CI loops.  If a fallback generator is provided, use that.
		let baselineZip;
		const fallbackGen = this.getFallbackCommit?.(baselineCommit!);
		const recentBuilds = await getBuilds(this.adoConnection, {
			project: this.adoConstants.projectName,
			definitions: [this.adoConstants.ciBuildDefinitionId],
			maxBuildsPerDefinition:
				this.adoConstants.buildsToSearch ?? ADOSizeComparator.defaultBuildsToSearch,
		});
		while (baselineCommit !== undefined) {
			const baselineBuild = recentBuilds.find(
				(build) => build.sourceVersion === baselineCommit,
			);

			if (baselineBuild === undefined) {
				baselineCommit = fallbackGen?.next().value;
				// For reasons that I don't understand, the "undefined" string is omitted in the log output, which makes the
				// output very confusing. The string is capitalized here and elsewhere in this file as a workaround.
				console.log(
					`Trying backup baseline commit when baseline build is UNDEFINED: ${baselineCommit}`,
				);
				continue;
			}

			// Baseline build does not have id
			if (baselineBuild.id === undefined) {
				const message = `Baseline build does not have a build id`;
				console.log(message);
				return { message, comparison: undefined };
			}

			// Baseline build is pending
			if (baselineBuild.status !== BuildStatus.Completed) {
				const message = getSimpleComment(
					"Baseline build for this PR has not yet completed.",
					baselineCommit,
				);
				console.log(message);

				if (tagWaiting) {
					this.tagBuildAsWaiting(baselineCommit);
				}

				return { message, comparison: undefined };
			}

			// Baseline build failed
			if (baselineBuild.result !== BuildResult.Succeeded) {
				const message = getSimpleComment(
					"Baseline CI build failed, cannot generate bundle analysis at this time",
					baselineCommit,
				);
				console.log(message);
				return { message, comparison: undefined };
			}

			// Baseline build succeeded
			console.log(`Found baseline build with id: ${baselineBuild.id}`);
			console.log(`projectName: ${this.adoConstants.projectName}`);
			console.log(
				`bundleAnalysisArtifactName: ${this.adoConstants.bundleAnalysisArtifactName}`,
			);

			baselineZip = await getZipObjectFromArtifact(
				this.adoConnection,
				this.adoConstants.projectName,
				baselineBuild.id,
				this.adoConstants.bundleAnalysisArtifactName,
			).catch((error) => {
				console.log(`Error unzipping object from artifact: ${error.message}`);
				console.log(`Error stack: ${error.stack}`);
				return undefined;
			});

			// For reasons that I don't understand, the "undefined" string is omitted in the log output, which makes the
			// output very confusing. The string is capitalized here and elsewhere in this file as a workaround.
			console.log(`Baseline Zip === UNDEFINED: ${baselineZip === undefined}`);

			// Successful baseline build does not have the needed build artifacts
			if (baselineZip === undefined) {
				baselineCommit = this.getFallbackCommit?.(baselineCommit).next().value;
				console.log(
					`Trying backup baseline commit when successful baseline build does not have the needed build artifacts ${baselineCommit}`,
				);
				continue;
			}

			// Found usable baseline zip
			break;
		}

		// Unable to find a usable baseline
		if (baselineCommit === undefined || baselineZip === undefined) {
			const message = `Could not find a usable baseline build with search starting at CI ${getBaselineCommit()}`;
			console.log(message);
			return { message, comparison: undefined };
		}

		const comparison: BundleComparison[] = await this.createComparisonFromZip(baselineZip);
		console.log(JSON.stringify(comparison));

		const message = getCommentForBundleDiff(comparison, baselineCommit);
		console.log(message);

		return { message, comparison };
	}

	private async tagBuildAsWaiting(baselineCommit: string): Promise<void> {
		if (!this.adoBuildId) {
			console.log(
				"No ADO build ID was provided, we will not tag this build for follow up when the baseline build completes",
			);
		} else {
			// Tag the current build as waiting for the results of the master CI
			const buildApi = await this.adoConnection.getBuildApi();
			await buildApi.addBuildTag(
				this.adoConstants.projectName,
				this.adoBuildId,
				getBuildTagForCommit(baselineCommit),
			);
		}
	}

	private async createComparisonFromZip(baselineZip: JSZip): Promise<BundleComparison[]> {
		const baselineZipBundlePaths = getBundlePathsFromZipObject(baselineZip);

		const prBundleFileSystemPaths = await getBundlePathsFromFileSystem(this.localReportPath);

		const configFileMap = await getBundleBuddyConfigMap({
			bundleFileData: prBundleFileSystemPaths,
			getBundleBuddyConfig: (relativePath) =>
				getBundleBuddyConfigFromFileSystem(join(this.localReportPath, relativePath)),
		});

		const baselineSummaries = await getBundleSummaries({
			bundlePaths: baselineZipBundlePaths,
			getStatsFile: (relativePath) => getStatsFileFromZip(baselineZip, relativePath),
			getBundleBuddyConfigFile: (bundleName) => configFileMap.get(bundleName),
			statsProcessors: DefaultStatsProcessors,
		});

		const prSummaries = await getBundleSummaries({
			bundlePaths: prBundleFileSystemPaths,
			getStatsFile: (relativePath) =>
				getStatsFileFromFileSystem(join(this.localReportPath, relativePath)),
			getBundleBuddyConfigFile: (bundleName) => configFileMap.get(bundleName),
			statsProcessors: DefaultStatsProcessors,
		});

		return compareBundles(baselineSummaries, prSummaries);
	}
}
