COMPANION v7 UPDATE
===================

Built for the Companion v5/v6 app at:
C:\AI\Companion\app

INSTALL
1. CLOSE Companion completely.
2. Extract this ZIP anywhere (Downloads/Desktop is fine).
3. Open the Companion-v7-PATCH folder.
4. Double-click RUN_UPDATE.bat.
5. It creates a backup inside C:\AI\Companion\app\_backup_before_v7_<date>.
6. It applies the update and runs npm typecheck.
7. Start Companion normally with C:\AI\Companion\app\START_COMPANION.bat.

WHAT v7 ADDS / FIXES
- Fixes generated avatar ownership so switching Lena -> Jade during generation cannot assign Lena's result to Jade.
- Adult media setting is always ON for characters with an explicit age of 18+.
- Consensual adult 18+ chat is not refused merely for being sexual; protections remain for minors and non-consensual/exploitative sexual content.
- Delays the ComfyUI -> Qwen handoff to prevent the completed-image ECONNRESET failure seen in the log.
- Adds PC-hosted phone access on port 8765. All models/data stay on the PC.
- Creates PHONE_ACCESS.txt in the app folder with the phone URL/code.
- Adds a desktop "Media / Prompt / Delete" button.
- Shows request prompt, final stored prompt, seed and stored generation settings.
- Lets you reuse a prompt + seed.
- Adds delete for generated media, individual messages, all chat history, and characters.
- Adds photo/avatar controls for prompt, seed, Fast/HD, framing mode, dimensions, steps, negative prompt, reference image, location/outfit/activity locks.
- New generated photos/videos sent through the v7 panel are attached to chat.

IMPORTANT ABOUT NSFW IMAGES
Companion no longer blocks the adult prompt at the app setting level for explicitly adult characters. However, an image MODEL or ComfyUI workflow can still have its own training/alignment limitations. The new prompt/seed inspector shows the exact stored final prompt so you can tell whether Companion passed the request through. If the final prompt is correct but the image stays censored/wrong, the next change needed is the image checkpoint/workflow, not another app toggle.

PHONE ACCESS
- Same Wi-Fi: use the URL in PHONE_ACCESS.txt.
- Tailscale: if installed, its private IP also appears as a network address.
- Do NOT port-forward TCP 8765 to the public internet.
- Qwen, ComfyUI, companion.db, images, videos and chat history remain on the PC.

ROLLBACK
If the update/typecheck fails, use RESTORE_LAST_BACKUP.bat.
