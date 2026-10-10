# Whole island framing — SUBSTITUÍDO

> **Substituído em 10/10/2026 pelo D-019** (decisão do usuário: mapa gigante, câmera que segue o jogador) e por
> [`camera-follow-contract.md`](camera-follow-contract.md) (cards `NEW-20261009-ORQ-camera-segue` e
> `NEW-20261009-UX-camera-segue`). Este contrato **não vale mais** para a câmera do jogo: não "conserte" a câmera de
> volta para a ilha inteira. O `fitIsland` continua no código só como visão geral de depuração
> (`?sandbox=horda&camera=ilha`). Também ficam revogados o "Proibido: cortar a ilha ao girar o celular" do
> `docs/cards.md` (cópia do PC) e o "Keep full island framed / cropped full island" do `camera-trees-contract.md`.
> O `NEW-20261006-E5-portrait-horde-zoom` foi absorvido pela câmera que segue (o aceite de bicho ≥ 28 px passou para ela).

Texto original, mantido como histórico:

Expected: the entire island, including its coast, cliff edges and scenery, remains visible in portrait and landscape. Rotation resizes the camera projection without changing room/player identity. Canvas still fills the viewport; transparent controls remain at the corners.

Forbidden: considering canvas size alone proof that the map fits; fixed close-up zoom; following the character in a way that crops the island after moving.

Proof: frame contains computed world bounds at 320x640, 390x844, 844x390 and 1280x720. Inspect screenshots of the island coastline in portrait and landscape; verify rotation in the same production room. Existing movement/attack tests remain passing.

Cause: camera used a fixed .94/1.16 zoom and recentered on the hero each update, independently of the island size. The canvas resized, but the visible world area was cropped.

Implemented in 04a61c2: camera bounds include coast, terrain cliffs, scenery and character silhouettes at island edges. Zoom takes both viewport axes into account with a 16px margin. Removed all per-frame character following. Solo movement after resize still shows complete island. Type checks, 30 tests and build passed. Browser screenshots confirmed portrait 390x844 and landscape 844x390. Pure geometric containment additionally passed 320x640, 1280x720, 1920x1080 and 640x320. No physical-phone verification.
