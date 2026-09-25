# Choose the first workflow seam for the architecture blueprint

Type: grilling
Status: resolved
Blocked by: none

## Question

Which evidence-backed workflow seam should anchor the first migration stage? Compare the source-to-parse lifecycle (snapshot, parse preference, result/error ownership), paired clipboard serialization, and preview-query access through the export module; include another seam only if the audit identifies a stronger case. Choose the first seam and explain what repeated change or regression it should make local. This decides priority, not an implementation interface.

## Answer

Implement all three evidence-backed seams in this slice, in this order: source-to-parse lifecycle, paired clipboard serialization, and preview-query access. The source seam comes first because snapshot matching, parse preference, and result/error ownership cross the most boundaries. Keep future capabilities and the release loader model outside this implementation scope.
