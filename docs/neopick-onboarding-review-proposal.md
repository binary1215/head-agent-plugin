# NeoPick onboarding review proposal

Status: proposal only; no Product Canon promotion or remote GraphDB write has occurred.

This document records the user-review boundary for the isolated NeoPick onboarding run produced by onboarding inference `0.3.0`. It is not project canon and must not be applied without an explicit review decision over the exact candidate-set identity below.

## Evidence boundary

- candidate set: `onboarding-candidates-3dce86f1d1a654f9b9ad6007`
- source snapshot: `source-snapshot-bb41ce25b7b8d957b75bb1b9`
- local graph snapshot: `graph-snapshot-98a6a3779cd0fa43ba64c9aa`
- repository scope: 870 scanner-eligible files reduced to 291 selected files
- inferred candidates: 23, reduced from the previous 49 one-symbol/one-concept candidates
- Context Compiler: the same 4,000-token Capsule was reproduced in 6.629 and 6.420 seconds
- authority effect: none; all candidates retain false instruction and promotion authority
- original NeoPick source mutation: none

## Why `accept-all` is not recommended

The candidate batch now clusters related symbols and excludes common close/click/create/logging handlers, but it still contains code-oriented Feature names. The one documentation-derived `PLC communication` FeatureGroup also does not justify placing every Feature under that group. The correct next action is `revise`, producing a successor candidate set that can be reviewed separately before any Product Canon promotion.

## Proposed product grouping

| Proposed FeatureGroup | Candidate Capabilities |
| --- | --- |
| Vision and Calibration | Calibration, Image Acquisition, Point Cloud Processing, Sensor Alignment |
| Inference and Segmentation | Inference, Inference Model Management |
| Picking and Robot Control | Picking Control, Robot Configuration |
| PLC and External Integration | PLC Communication, External Communication |
| Runtime Data Exchange | Shared State Transport |

The existing `PLC communication` FeatureGroup candidate should be revised into `PLC and External Integration`. The other four groups should be added as review candidates. No group relationship should be inferred from repository directories.

## Proposed Feature edits

| Candidate ID | Current inferred name | Proposed review name | Proposed FeatureGroup |
| --- | --- | --- | --- |
| `onboarding-candidate-a55ffda91cf0599f36de5896` | calib processor | Camera Calibration Processing | Vision and Calibration |
| `onboarding-candidate-e66b3f8ec8fe636bd9b883f0` | capture image request | Camera Image Capture | Vision and Calibration |
| `onboarding-candidate-81047536138681264a996391` | capture point cloud | 3D Point Cloud Capture | Vision and Calibration |
| `onboarding-candidate-37a927312f66e02bda617b61` | align ir to color | Infrared and Color Sensor Alignment | Vision and Calibration |
| `onboarding-candidate-0d2106c0d88a20c0c25d03e4` | capture inference | Vision Inference Execution | Inference and Segmentation |
| `onboarding-candidate-75989827cf25953a0854a2f7` | create sam2 transformer | Segmentation Model Initialization | Inference and Segmentation |
| `onboarding-candidate-402c832fc9d04dace3cb3a8a` | find picking point | Picking Point Selection | Picking and Robot Control |
| `onboarding-candidate-1ace7bfd22d2d4b7d2447481` | default robot runtime config | Robot Runtime Configuration | Picking and Robot Control |
| `onboarding-candidate-13f5ee419174ba4c6574ed36` | check connection | PLC Connection Monitoring | PLC and External Integration |
| `onboarding-candidate-75fa130d8092972317f80012` | get command from receiver | Receive External Control Commands | PLC and External Integration |
| `onboarding-candidate-0f10e33ff77fdcedeceee512` | begin reading | Shared Inference State Reading | Runtime Data Exchange |

The eleven Capability candidates may remain unchanged in the successor review batch. Their evidence paths and confidence values remain available in the immutable candidate set; the names above are a proposed human-facing normalization, not a claim that implementation evidence defines product intent.

## Required authority transition

1. The user approves, changes, or rejects this grouping and naming proposal.
2. HEAD records a `revise` ReviewDecision against the exact current candidate set.
3. The resulting successor candidate set is shown in full.
4. A separate explicit `accept-selection`, further `revise`, or `reject` decision determines whether Product Canon changes.
5. Only after that review should Feature-to-code mapping candidates be generated and the derived graph be activated against the selected `neopick` database.

If the source snapshot or candidate-set identity changes, this proposal is stale and must be regenerated rather than applied by name matching.
