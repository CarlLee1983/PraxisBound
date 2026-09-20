export {
  IMPLEMENTED_PROTOCOL_VERSION,
  RESULT_SCHEMA_VERSION,
  ResultEnvelopeValidationError,
  assertResultEnvelope,
  validateResultEnvelope,
} from "./result.js";

export type {
  ResultEnvelope,
  ResultError,
  ResultEnvelopeValidation,
  ResultExit,
  ResultDataValue,
  ResultIssue,
  ResultOutcome,
  ResultStatus,
  ResultValidationIssue,
} from "./result.js";

export { evaluateReleaseReadiness } from "./release.js";
export type {
  ReleaseIndexFlags,
  ReleaseReadinessEvaluation,
  ReleaseReadinessInput,
  ReleaseReadinessOutcome,
  ReleaseReadinessState,
  ReleaseTagState,
  ReleaseVersionObject,
  ReleaseWorkingVersion,
  ReleaseWorktree,
} from "./release.js";

export {
  adoptionMarkerPath,
  createAdoptionMarker,
  evaluateInitMutation,
  findInitPreconditionMismatches,
  getInitObservationScope,
  planMutation,
} from "./init.js";

export type {
  MutationExecutionObservation,
  MutationFailure,
  MutationFailureStage,
  MutationPathKind,
  MutationPathObservation,
  MutationStageObservation,
  MutationStagePrecondition,
} from "./mutation.js";

export {
  activationAdoptionPath,
  activationDestinations,
  activationDirectories,
  activationSkillDirectory,
  activationSnapshotPath,
  legacyActivationDestinations,
  legacyActivationSkillDirectory,
  legacyActivationSnapshotPath,
  evaluateActivationAcquisition,
  evaluateActivationMutation,
  evaluateActivationScratchCleanup,
  findActivationPreconditionMismatches,
  getActivationObservationScope,
  planActivation,
  posixCksum,
} from "./activation.js";
export type {
  ActivationAcquisitionObservation,
  ActivationMutationPlan,
  ActivationPathObservation,
  ActivationPathPrecondition,
  ActivationPlanEvaluation,
  ActivationPlannedChange,
  ActivationPlannedPayload,
  ActivationPlanRequest,
  ActivationScratchCleanupObservation,
  ActivationSourceAsset,
  ActivationSourceSnapshot,
} from "./activation.js";
export type {
  InitChangeKind,
  InitMode,
  InitMutationExecutionObservation,
  InitMutationFailure,
  InitMutationFailureStage,
  InitMutationPlan,
  InitPathKind,
  InitPathObservation,
  InitPlanEvaluation,
  InitPlanRequest,
  InitPlannedChange,
  InitSnapshot,
  InitSnapshotPayload,
  InitStagePrecondition,
  InitStageObservation,
} from "./init.js";

export { adoptionNextSteps } from "./adoption-next-steps.js";
export type { AdoptionNextStep } from "./adoption-next-steps.js";

export { evaluateRepositoryDoctor } from "./repository.js";
export type {
  RepositoryComposedObservation,
  RepositoryDoctorEvaluation,
  RepositoryDoctorFact,
  RepositoryDoctorOutcome,
  RepositoryDoctorSnapshot,
  RepositoryPathKind,
  RepositoryPathObservation,
} from "./repository.js";

export { evaluateHandoff } from "./handoff.js";
export type { HandoffEvaluation, HandoffEvidence } from "./handoff.js";

export { resolveVerificationPlan } from "./verification.js";
export type {
  VerificationAuthority,
  VerificationAuthorityOperation,
  VerificationLayer,
  VerificationLevel,
  VerificationPlan,
  VerificationPlanEvaluation,
  VerificationTaskMode,
} from "./verification.js";

export {
  SUPPORTED_PROTOCOL_RANGE,
  getToolingCapabilities,
  resolveProtocolSelector,
} from "./protocol.js";

export type {
  ProtocolSelection,
  ProtocolSelectionErrorCode,
  ProtocolSelector,
  ProtocolSelectorSource,
  ToolingCapabilities,
} from "./protocol.js";

export { evaluateVerificationResult } from "./verification-result.js";
export type {
  VerificationCheckStatus,
  VerificationDiagnostic,
  VerificationDiagnosticKind,
  VerificationEvidenceStatus,
  VerificationRecord,
  VerificationRecordStatus,
  VerificationRecordedCheck,
  VerificationResultEvaluation,
  VerificationResultSources,
} from "./verification-result.js";

export {
  evaluateStoryContract,
  evaluateStoryReadiness,
  readStoryDecisions,
} from "./story.js";
export type {
  StoryContractEvaluation,
  StoryContractSources,
  StoryDecisionRecord,
  StoryFacts,
  StoryReadinessEvaluation,
} from "./story.js";

export { indexReviewBatch } from "./review/index.js";
export { planReviewBatch } from "./review/manifest.js";
export { renderReviewProjection } from "./review/render.js";
export { sha256Hex } from "./review/fingerprint.js";
export type {
  AdrIndex,
  IndexReviewBatchResult,
  Locator,
  PlanReviewBatchResult,
  ReviewBatchPlan,
  ReviewBatchPlanDependency,
  ReviewBatchPlanRequirement,
  ReviewBatchStoryPlan,
  ReviewDiagnostic,
  ReviewDiagnosticSeverity,
  ReviewIndex,
  ReviewObservations,
  SourceDigest,
  SourceObservation,
  SpecAcceptanceEntry,
  SpecEntryIndex,
  SpecIndex,
  SpecSectionIndex,
  StoryIndex,
  TraceEntry,
  TraceStoryEntry,
} from "./review/types.js";
export type { ReviewProjectionDocument } from "./review/render.js";

export {
  rawJsonMaxDepth,
  jsonParseFailureMessage,
} from "./review/revision-limits.js";

export {
  dedupeRevisions,
  parseRevisionSheetBlock,
  revisionContentKey,
  sameRevisionContent,
  supersedesConflicts,
  validateStoredRevisionRecord,
} from "./review/revision-sheet.js";
export { validateRevisionRecordSet } from "./review/revision-content.js";
export type {
  PathedRevisionRecords,
  RecordSetConflict,
  RecordSetValidation,
} from "./review/revision-content.js";
export type {
  DedupeResult,
  RevisionKind,
  RevisionLocatorValue,
  RevisionRecord,
  RevisionRecordValidationResult,
  RevisionSheetData,
  RevisionSheetParseResult,
  SupersedesConflict,
} from "./review/revision-sheet.js";

export {
  parseRevisionResponses,
  validateStoredResponsesRecord,
} from "./review/revision-responses.js";
export type {
  ResponseOutcome,
  ResponseRecord,
  ResponseRoute,
  RevisionResponsesData,
  RevisionResponsesParseResult,
  RevisionResponsesValidationResult,
} from "./review/revision-responses.js";

export {
  buildTargetLookup,
  matchRevisionTarget,
} from "./review/revision-targets.js";
export type { TargetLookup, TargetMatch } from "./review/revision-targets.js";

export {
  GOAL_PLAN_MANIFEST_SCHEMA_VERSION,
  PLAN_COVERAGE_REVIEW_SCHEMA_VERSION,
  exportGoalPlanManifest,
  exportPlanCoverageReview,
  validateGoalPlanManifest,
  validatePlanCoverageReview,
} from "./goal-plan-artifacts.js";
export type {
  GoalPlanArtifactClass,
  GoalPlanEdge,
  GoalPlanFailureCategory,
  GoalPlanManifest,
  GoalPlanManifestExportInput,
  GoalPlanManifestValidation,
  GoalPlanManifestValidationSuccess,
  GoalPlanNode,
  GoalPlanReadinessContract,
  GoalPlanSourceBytes,
  GoalPlanSourceDigest,
  GoalPlanSourceFacts,
  GoalPlanValidationFailure,
  PlanCoverageReview,
  PlanCoverageReviewExportInput,
  PlanCoverageReviewValidation,
  PlanCoverageReviewValidationSuccess,
} from "./goal-plan-artifacts.js";
