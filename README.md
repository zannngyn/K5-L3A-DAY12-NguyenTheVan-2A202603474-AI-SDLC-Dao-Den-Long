# Đảo Đèn Lồng (Lantern Island)

*(video: sẽ thêm ở Phase 4)*

Game 3D góc nhìn thứ ba xây dựng bằng **Three.js + TypeScript** (mô phỏng tất định 60 ticks/s, tuân thủ **Test Contract v1.2**). Người chơi vào vai **Mây**, thu thập đom đóm, thắp và tiếp dầu cho các Đèn Lồng Lớn, né **Bóng Mực** và **Gió Lạc** để giữ đảo sáng tới bình minh qua 3 Đêm (**Đảo Bến**, **Đảo Cầu**, **Đảo Chuông**).

---

## Cài đặt & Chạy nhanh

```bash
npm install
npm run dev
npm run verify
```

- `npm run dev`: chạy bản game 3D trên trình duyệt (Vite).
- `npm run verify`: chạy toàn bộ `typecheck`, unit test (`vitest`) và kiểm chứng headless (`scripts/verify.sh`).
- Build sản phẩm: `npm run build`.

---

## Điều khiển

| Hành động | Phím / Chuột |
|---|---|
| Di chuyển | `W` `A` `S` `D` hoặc phím mũi tên (`↑` `↓` `←` `→`) |
| Nhảy | `Space` |
| Lướt (Dash) | `Shift` |
| Tương tác / Nạp đom đóm / Tiếp dầu | `E` |
| Tỏa Sáng (Pulse) | `Q` hoặc **Chuột phải** |
| Xoay camera | Di chuột (**click chuột trái** để khóa con trỏ / pointer lock) hoặc phím `J` / `K` |
| Tạm dừng (Pause) | `Esc` hoặc `P` |

Cài đặt hỗ trợ âm lượng, độ nhạy chuột và chế độ **Bảng màu dễ phân biệt** (lưu trong `localStorage`).

---

## Luật thắng & Tính điểm (Contract v1.2)

- **Thắng Đêm (`dawn_survived`):** Sống sót đến hết giờ (bình minh) với số đèn đang sáng `>= ceil(0.6 * n)` — Đêm 1: `3/5` (`240 s`), Đêm 2: `4/6` (`270 s`), Đêm 3: `5/7` (`300 s`). Thắp hết đèn **không** kết thúc sớm.
- **Thua Đêm:** Hết ngọn lửa (`no_flames`, ưu tiên kiểm tra trước ngay cả ở tick bình minh) hoặc hết giờ nhưng không đủ đèn sáng (`dawn`).
- **Sức chứa đom đóm:** `capacity = min(20, 10 + 2 * successful_lights)` mỗi Đêm (tính cả thắp lại; đèn đặt sẵn trong scenario không tính; reset về `10` khi sang Đêm mới).
- **Công thức điểm (v1.2):**
  - `+5` điểm / đom đóm nạp (thắp mới, thắp lại hoặc tiếp dầu).
  - `+100` điểm khi thắp đèn lần đầu; `+40` điểm khi thắp lại đèn đã từng sáng (`ever_lit`, chỉ tốn `5` đom đóm).
  - **Tỏa Sáng (Pulse)** trúng Bóng Mực: `+5` điểm / con; `+15` điểm tổng nếu con đó đang ở trạng thái `drain` ngay trước khi trúng.
  - **Thưởng bình minh (chỉ khi thắng):** `+50 + floor(fuel)` cho mỗi đèn đang sáng và `+50` cho mỗi ngọn lửa còn lại (đã bỏ thưởng thời gian còn lại).
  - **Tổng điểm chiến dịch:** tổng điểm các Đêm thắng.

---

## Chế độ Headless & Test Contract

Mô phỏng chạy độc lập không cần trình duyệt qua CLI (`src/headless/cli.ts`), cấu hình chuẩn khai báo trong [game.contract.json](game.contract.json) (`contract_version: "1.2"`).

Ví dụ chạy headless:

```bash
npx tsx src/headless/cli.ts --seed 1 --night 1 --ticks 600 --snapshot-every 10 --out docs/proof/sample.jsonl
```

Cờ tùy chọn: `--scenario <file.json>`, `--inputs <file.json>`, `--snapshot-every <N>` (cũng có thể chạy qua `npm run headless -- ...`).

- **Định dạng `scenario` JSON:** đối tượng JSON tùy chọn gồm `player` (`pos`, `carried`, `flames`, `successful_lights`, `invuln_ticks`, `dash_cd_ticks`, `pulse_cd_ticks`, `charm_ticks`), `lanterns[]` (`id`, `pos`, `deposited`, `lit`, `fuel`, `ever_lit`; nếu `lit: true` mà bỏ qua `fuel` thì mặc định `100`), `shades[]` (`id`, `pos`, `state`, `state_ticks_left`, `target_lantern_id`), `motes[]`, `drifters[]`, `charms[]`, `time_left_s` và các cờ `random_motes`, `random_shades`, `random_drifters`, `wind_enabled`.
- **Định dạng `inputs` JSON:** `{ "frames": [ { "tick": 0, "move": [x, z], "cam_yaw_deg": 0, "jump": false, "interact": false, "pulse": false, "dash": false, "pause": false } ] }` với `tick` nguyên không âm và **tăng nghiêm ngặt** (lỗi định dạng thoát mã `2`).

---

## Ghi chú Tuning & Giả định

### Tuning (`game.contract.json` ↔ `src/sim/tuning.ts`)
- `motes[].ttl_s` nhận `null` với đom đóm sinh ngẫu nhiên (`kind: "random"`) và số giây hữu hạn với đom đóm rơi (`kind: "dropped"`).
- `fall_enabled: true`: bước khỏi rìa đảo (`Y < -10`) mất 1 ngọn lửa, mất toàn bộ đom đóm đang mang, chờ `60` tick rồi hồi sinh.
- `fuel` được tính nội bộ theo đơn vị nguyên `1/60` (`0..6000`) để tránh sai số dấu phẩy động, chỉ làm tròn 1 chữ số thập phân khi xuất snapshot/event.
- `shade_speed: 4.0` áp dụng cho Đêm 1–2; Đêm 3 dùng `4.5 m/s` theo bản đồ Đảo Chuông.
- `carry_capacity: 10` là sức chứa khởi đầu mỗi Đêm và tăng dần tới `capacity_max: 20`.

### Các giả định chính
- **Điểm xuất phát Đêm 3 là `(0, 0, -12)`** (Tầng 0, nhìn hướng `+Z`) vì `(0, 0, 0)` nằm bên trong Tháp Chuông đặc ở tâm Tầng 2.
- Tọa độ cực dùng quy ước `x = r * cos(θ), z = r * sin(θ)` đo từ trục `+X` ngược chiều kim đồng hồ.
- Sự kiện `night_start` phát ở `sim_tick = 1` để snapshot tick `0` sau khi nạp scenario không chứa sự kiện.
- Chi tiết giả định xem thêm tại [docs/notes/assumptions-phase2.md](docs/notes/assumptions-phase2.md) và [docs/notes/spec-phase3.md](docs/notes/spec-phase3.md).

---

## Sáng tạo của tôi

- **Bướm Đèn (Lantern Moth Companion)** — [src/renderer/mothCompanion.ts](src/renderer/mothCompanion.ts): một chú bướm giấy phát sáng bay cạnh Mây, vỗ cánh nhanh hơn và bay dẫn hướng về đèn cần thắp khi Mây mang đủ đom đóm, đồng thời tóe hạt sáng khi thắp đèn / Tỏa Sáng / nhặt Bùa Gió. Dùng vật liệu phát sáng (không tạo thêm `PointLight`).
- **Tách biệt hoàn toàn khỏi headless:** chỉ đọc `SimSnapshot` và `SimEvent[]` ở tầng renderer; không có bất kỳ import nào từ `src/renderer` trong `src/sim` hay `src/headless`. Bằng chứng: mã băm `sha256` của output JSONL headless cho cùng `seed`/`scenario` luôn giống hệt nhau bất kể client.

---

## Kiểm thử & Cấu trúc Repo

Chạy kiểm thử riêng lẻ: `npm run typecheck`, `npm test`, hoặc toàn bộ qua `npm run verify`.

```text
src/
  sim/        # Mô phỏng thuần tất định 60 Hz (không DOM, không Three.js, không Math.random)
  headless/   # CLI chạy kịch bản & xuất JSONL (src/headless/cli.ts)
  renderer/   # Scene 3D Three.js, địa hình 3 Đêm, Bướm Đèn, bảng màu
  hud/ ui/    # HUD, menu 3 Đêm, Pause, Settings (gồm chế độ mù màu)
  input/      # Bàn phím, chuột pointer-lock, camera J/K
  audio/      # Nhạc nền đêm và hiệu ứng WebAudio
tests/        # Unit test mô phỏng & CLI (Vitest)
scripts/      # Script kiểm chứng tự động (verify.sh)
docs/notes/   # ADR, spec, giả định, nhật ký AI, retro
docs/proof/   # Bằng chứng kiểm chứng và kịch bản headless từng phase
```

## Harness & Tài liệu dự án

- **AI Harness:** [AGENTS.md](AGENTS.md), [.claude/skills/headless-proof/SKILL.md](.claude/skills/headless-proof/SKILL.md)
- **Thiết kế & Ghi chép:** [CHANGELOG.md](CHANGELOG.md), [ADR-0001](docs/notes/adr-0001-lantern-fuel-and-dawn-win.md), [Spec Phase 3](docs/notes/spec-phase3.md), [AI Log](docs/notes/ai-log.md), [Assumptions Phase 2](docs/notes/assumptions-phase2.md), [Retro Draft](docs/notes/retro-draft.md)
- **Bằng chứng kiểm chứng:** [docs/proof/phase-1.md](docs/proof/phase-1.md), [docs/proof/phase-2.md](docs/proof/phase-2.md)

## Tài liệu gốc của Lab

- [GUIDE.md](GUIDE.md) · [CHECKPOINTS.md](CHECKPOINTS.md) · [SUBMISSION.md](SUBMISSION.md) · [RULES.md](RULES.md) · [RUBRIC.md](RUBRIC.md) · [CREDITS.md](CREDITS.md) · [Lab Board](https://claude.ai/artifact/Q1RYyv1dxjUczzCbd2ZnoW)
