/*
 * Copyright © 2018 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    allSatisfied,
    hasFile,
    not,
    SoftwareDeliveryMachine,
} from "@atomist/sdm";
import * as build from "@atomist/sdm/dsl/buildDsl";
import {
    DockerBuildGoal,
    VersionGoal,
} from "@atomist/sdm/goal/common/commonGoals";
import {
    executePublish,
    NpmOptions,
} from "@atomist/sdm/internal/delivery/build/local/npm/executePublish";
import { NodeProjectIdentifier } from "@atomist/sdm/internal/delivery/build/local/npm/nodeProjectIdentifier";
import { NodeProjectVersioner } from "@atomist/sdm/internal/delivery/build/local/npm/nodeProjectVersioner";
import {
    nodeBuilder,
    NpmPreparations,
} from "@atomist/sdm/internal/delivery/build/local/npm/npmBuilder";
import { executeVersioner } from "@atomist/sdm/internal/delivery/build/local/projectVersioner";
import { IsNode } from "@atomist/sdm/mapping/pushtest/node/nodePushTests";
import {
    DefaultDockerImageNameCreator,
    DockerOptions,
    executeDockerBuild,
} from "@atomist/sdm/pack/docker/executeDockerBuild";
import { PackageLockFingerprinter } from "@atomist/sdm/pack/node/PackageLockFingerprinter";
import { tslintFix } from "@atomist/sdm/pack/node/tslint";
import { tagRepo } from "@atomist/sdm/util/github/tagRepo";
import { AutomationClientTagger } from "../support/tagger";
import {
    ProductionDeploymentGoal,
    PublishGoal,
    ReleaseArtifactGoal,
    ReleaseDockerGoal,
    ReleaseDocsGoal,
    ReleaseVersionGoal,
    StagingDeploymentGoal,
} from "./goals";
import {
    DockerReleasePreparations,
    DocsReleasePreparations,
    executeReleaseDocker,
    executeReleaseDocs,
    executeReleaseNpm,
    executeReleaseVersion,
    NpmReleasePreparations,
} from "./release";

export function addNodeSupport(sdm: SoftwareDeliveryMachine) {

    const hasPackageLock = hasFile("package-lock.json");

    sdm.addBuildRules(
        build.when(IsNode, hasPackageLock)
            .itMeans("npm run build")
            .set(nodeBuilder(sdm.configuration.sdm.projectLoader, "npm ci", "npm run build")),
        build.when(IsNode, not(hasPackageLock))
            .itMeans("npm run build (no package-lock.json)")
            .set(nodeBuilder(sdm.configuration.sdm.projectLoader, "npm install", "npm run build")));

    sdm.addGoalImplementation("nodeVersioner", VersionGoal,
        executeVersioner(sdm.configuration.sdm.projectLoader, NodeProjectVersioner), { pushTest: IsNode })
        .addGoalImplementation("nodeDockerBuild", DockerBuildGoal,
            executeDockerBuild(
                sdm.configuration.sdms.projectLoader,
                DefaultDockerImageNameCreator,
                NpmPreparations,
                {
                    ...sdm.configuration.sdm.docker.hub as DockerOptions,
                    dockerfileFinder: async () => "Dockerfile",
                }), { pushTest: IsNode })
        .addGoalImplementation("nodePublish", PublishGoal,
            executePublish(
                sdm.configuration.sdm.projectLoader,
                NodeProjectIdentifier,
                NpmPreparations,
                {
                    ...sdm.configuration.sdm.npm as NpmOptions,
                }), { pushTest: IsNode })
        .addGoalImplementation("nodeNpmRelease", ReleaseArtifactGoal,
            executeReleaseNpm(
                sdm.configuration.sdm.projectLoader,
                NodeProjectIdentifier,
                NpmReleasePreparations,
                {
                    ...sdm.configuration.sdm.npm as NpmOptions,
                }), { pushTest: IsNode })
        .addGoalImplementation("nodeDockerRelease", ReleaseDockerGoal,
            executeReleaseDocker(
                sdm.configuration.sdm.projectLoader,
                DockerReleasePreparations,
                {
                    ...sdm.configuration.sdm.docker.hub as DockerOptions,
                }), { pushTest: allSatisfied(IsNode, hasFile("Dockerfile")) })
        // Why is the push test not enough to prevent a duplicate goal error from happening
        // .addGoalImplementation("tagRelease", ReleaseTagGoal,
        //     executeReleaseTag(sdm.opts.projectLoader), { pushTest: IsNode })
        .addGoalImplementation("nodeDocsRelease", ReleaseDocsGoal,
            executeReleaseDocs(sdm.configuration.sdm.projectLoader, DocsReleasePreparations), { pushTest: IsNode })
        .addGoalImplementation("nodeVersionRelease", ReleaseVersionGoal,
            executeReleaseVersion(sdm.configuration.sdm.projectLoader, NodeProjectIdentifier), { pushTest: IsNode });

    sdm.goalFulfillmentMapper
        .addSideEffect({
            goal: StagingDeploymentGoal,
            pushTest: IsNode,
            sideEffectName: "@atomist/k8-automation",
        })
        .addSideEffect({
            goal: ProductionDeploymentGoal,
            pushTest: IsNode,
            sideEffectName: "@atomist/k8-automation",
        });

    sdm.addNewRepoWithCodeActions(tagRepo(AutomationClientTagger))
        .addAutofixes(tslintFix)
        .addFingerprinterRegistrations(new PackageLockFingerprinter());

}
