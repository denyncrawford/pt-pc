# Browser fPKG extractor

PFS, PFSC, fPKG key layout and XTS sector handling are adapted from
[maxton/LibOrbisPkg](https://github.com/maxton/LibOrbisPkg), LGPL-3.0-or-later.
The TypeScript adaptation replaces native memory mapping and .NET crypto with
bounded random-access reads, noble-ciphers/noble-hashes and fflate. See LICENSE.txt.
The constants in fpkg-keys.ts come from its public Util/Keys.cs, not user packages.
Only fPKGs built from dumps are supported; retail console packages are unsupported.

Dependency licenses: noble-ciphers and noble-hashes MIT; fflate MIT.
No game resources are included. Retain this notice and the LGPL license when
redistributing. The browser module remains replaceable and its source is in this
package. This implementation does not verify all package signatures/digests.
