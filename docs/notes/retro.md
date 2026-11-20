# Tổng kết Dự án (Retrospective) — Đảo Đèn Lồng v1.0.0

Tài liệu tổng kết quá trình phát triển 4 giai đoạn (Phase 1 → Phase 4 / `v1.0.0`) theo quy trình AI-SDLC, dựa trên bằng chứng thực tế tại `docs/notes/ai-log.md`, `docs/proof/phase-1.md`, `docs/proof/phase-2.md`, `docs/proof/phase-3.md` và `docs/proof/review-client-phase3.md`.

---

## 1. Đánh giá 4 giai đoạn

| Giai đoạn | Phạm vi chính | Kết quả kiểm chứng thực tế | Nhận xét ngắn |
|---|---|---|---|
| **Phase 1** (`phase-1`, Contract v1.0) | Lõi mô phỏng 60 Hz (`src/sim/**`), CLI headless (`src/headless/cli.ts`), client 3D Night 1 + Bướm Đèn | `19/19` unit/CLI tests pass; `scripts/verify.sh` pass (`docs/proof/phase-1.md`). Tuy nhiên `npm run typecheck` bị chặn bởi lỗi `TS2882` import `./hud.css` ở `src/hud/hud.ts` (ngoài phạm vi sim worker). | Kiến trúc tách sạch `sim` và `renderer` phát huy hiệu quả ngay từ đầu; thiếu bước kiểm tra typecheck chéo sớm trước khi chốt. |
| **Phase 2** (`phase-2`, Contract v1.1) | Mở rộng 3 Đêm (Đảo Bến / Đảo Cầu / Đảo Chuông), Dash, Drifter, Wind Charm, gió, HUD/Settings/WebAudio, dựng AI Harness (`AGENTS.md`, `headless-proof`) | `28/28` tests pass; `npm run verify` exit `0`; Night 3 21.600 ticks hoàn thành trong `454 ms` (`<= 30000 ms`, `docs/proof/phase-2.md`). | Chuẩn hóa bảng tuning và phân quyền file giúp sim, client và docs chạy song song không xung đột; kiểm chứng thị giác vẫn ở trạng thái `"not verified"`. |
| **Phase 3** (`phase-3`, Contract v1.2) | Nhiên liệu đèn (`1/60` nguyên), tiếp dầu/thắp lại, vùng an toàn `fuel >= 30`, Bóng Mực `drain`, thắng bình minh `ceil(0.6*n)`, sức chứa động, chế độ mù màu | `40/40` tests pass; `34/34` kiểm tra trong `scripts/verify.sh` pass; Night 3 18.000 ticks chạy trong `575 ms` (`docs/proof/phase-3.md`). Review độc lập phát hiện 3 sai lệch client (`docs/proof/review-client-phase3.md`). | Luật `[REPLACE]` được truy vết rõ qua `ADR-0001` và `spec-phase3.md`. Tuy nhiên lỗi giật camera chỉ được phát hiện khi người dùng tự chơi thử. |
| **Phase 4** (`phase-4` / `v1.0.0`, Contract v1.3) | Launcher zero-dep (`scripts/play.mjs`), Benchmark 1280×720 (`200` Shades), Soak 10 Đêm, Bảng xếp hạng cục bộ, Accessibility (đổi phím, phụ đề, giảm chuyển động, chữ lớn), đóng gói zip phát hành | Tài liệu, spec (`spec-phase4.md`), harness và kiến trúc hoàn chỉnh; số đo `bench.json` / `soak.json` thực tế phụ thuộc lần chạy cuối sau khi mã song song hợp nhất. | Không thay đổi luật chơi giúp giữ nguyên toàn bộ bộ kiểm thử Phase 1–3; tập trung hoàn toàn vào phi chức năng và trải nghiệm người dùng. |

---

## 2. Điều hiệu quả & Điều chưa hiệu quả khi làm việc với AI

### Hiệu quả
- **Giao việc theo đặc tả trước (Spec-first handoffs):** Chuyển yêu cầu thô thành tài liệu đặc tả rõ ràng (`.swarm/specs/*`, `docs/notes/design-phase1.md`, `design-phase2.md`, `adr-0001-lantern-fuel-and-dawn-win.md`, `spec-phase3.md`, `spec-phase4.md`) trước khi viết mã giúp các worker thống nhất giao diện và giảm hiểu nhầm.
- **Phân quyền file nghiêm ngặt (Ownership split):** Tách 3 vùng `Sim & Headless`, `Client`, `Docs & Harness` cho phép làm song song nhiều tác vụ mà không đè file nhau.
- **Review độc lập tìm ra lỗi thật:** Phiên kiểm toán chỉ đọc tại `docs/proof/review-client-phase3.md` phát hiện 3 lỗi thực tế mà `npm run verify` không bắt được:
  - **D1 (Medium):** Màn hình kết thúc tính `Math.floor(l.fuel)` trên số đã làm tròn 1 chữ số thập phân thay vì `Math.floor(fuel_units / 60)`, gây lệch điểm `+1`/đèn (ví dụ `simScore = 447` so với bảng chi tiết `450`).
  - **D2 (Medium):** `sendPauseToggleToSim` tiêu thụ sự kiện trên tick resume nhưng bỏ qua `handleGameOver`, làm kẹt menu Pause nếu resume đúng tick bình minh cuối.
  - **D3 (Low):** Nhấn `interact` và `pulse` cùng tick gây lệch `+10` điểm thống kê Bóng Mực đang `drain` ở client.
- **Kiểm chứng tất định (Determinism checks):** So sánh byte-identical (`diff`/`cmp` + SHA-256) qua cả 3 Đêm ở `docs/proof/phase-2.md`, `phase-3.md` và `review-client-phase3.md` chứng minh lõi `src/sim` thuần khiết và Bướm Đèn ở tầng renderer không làm nhiễu mô phỏng.

### Chưa hiệu quả
- **Mở trang web kiểm tra thị giác quá muộn:** Qua Phase 1 và Phase 2, không có tác nhân nào thực sự mở trình duyệt để xem giao diện (các báo cáo phải ghi trung thực `"visual not verified"`).
- **Lỗi giật camera do người dùng tự phát hiện:** Toàn bộ unit test và headless CLI đều xanh, nhưng camera góc nhìn thứ ba bị giật rõ rệt khi chơi thật — cho thấy kiểm chứng headless không bao phủ trải nghiệm thị giác và chuyển động.
- **Chuỗi văn bản giao diện/tài liệu bị cũ (stale copy):** Một số tiêu đề không tự cập nhật theo phase (ví dụ `index.html` vẫn giữ `<title>Đảo Đèn Lồng — Ba Hòn Đảo</title>` và `CREDITS.md` vẫn giữ tiêu đề `Phase 2 ("Ba Hòn Đảo")` khi đã sang Phase 3–4).
- **Tạo git tag sớm trước khi hoàn tất mã:** Tag `phase-4` (commit `78a0fe0`) được tạo trước khi toàn bộ mã Benchmark, Soak, Leaderboard và Accessibility của Phase 4 hoàn thiện, làm lịch sử tag chưa khớp bản cuối.

---

## 3. Lỗi AI gặp phải & Cách phát hiện

| # | Lỗi / Sự cố | Cách phát hiện | Khắc phục & Cập nhật Harness |
|---|---|---|---|
| 1 | Lệnh shell của coordinator bị treo do chờ `stdin` (`docs/notes/ai-log.md`) | Lệnh timeout, không sinh output | Tránh lệnh tương tác; luôn truyền cờ không tương tác |
| 2 | Lỗi `TS2882` import `./hud.css` ở `src/hud/hud.ts` làm gãy `typecheck` Phase 1 (`docs/proof/phase-1.md`) | `npm run typecheck` báo lỗi | Giữ nguyên phân quyền file, báo lỗi chéo vùng về coordinator; ghi luật ownership vào `AGENTS.md` |
| 3 | Dev server lỗi khi biến môi trường cổng (port) bị rỗng (`docs/notes/ai-log.md`) | Lệnh khởi chạy thoát mã lỗi | Dùng cổng mặc định rõ ràng / `npm run dev` |
| 4 | Thiếu công cụ chụp màn hình trình duyệt khiến bước kiểm tra hình ảnh không chạy được | Worker báo trung thực `"visual not verified"` | Ghi quy tắc trung thực bằng chứng vào `AGENTS.md` và `SKILL.md` |
| 5 | Camera góc nhìn thứ ba bị giật khi chơi thực tế (`docs/notes/ai-log.md`) | Người dùng phát hiện khi chơi thử bằng tay | Sửa làm mượt/nội suy camera ở client; bổ sung lưu ý headless không thay thế kiểm tra trình duyệt |
| 6 | Lệch điểm màn kết thúc (D1, D3) và mất `game_over` khi resume tick cuối (D2) | Review độc lập (`docs/proof/review-client-phase3.md`) | Chuyển báo cáo chi tiết có đoạn tái hiện cho client worker sửa |

---

## 4. Harness hữu ích nhất

1. **`AGENTS.md` (ngắn <= 60 dòng) + Quy tắc Ownership:** Luôn nằm trong ngữ cảnh mà không tốn nhiều token, giữ chặt ranh giới `src/sim` thuần khiết, không sửa test để ép pass, và báo `"not verified"` trung thực.
2. **`scripts/verify.sh` + Skill `headless-proof` (`.claude/skills/headless-proof/SKILL.md`):** Chạy 1 lệnh (`npm run verify`) kiểm tra trọn gói typecheck, 40 unit/CLI tests, 34 kịch bản Contract, determinism và hiệu năng — giúp tự tin thay đổi luật lớn ở Phase 2 và Phase 3.
3. **Checklist review độc lập:** Tách riêng vai trò đọc-kiểm toán khỏi vai trò viết mã là cơ chế hiệu quả nhất để tìm lỗi logic biên giữa `sim` và `client`.

---

## 5. Chi phí Token & Cách tiết kiệm

- **Ước tính tổng token / chi phí (4 phase):** **TBD by user**
- **Các biện pháp tiết kiệm đã áp dụng:**
  - **Đưa đặc tả ra file:** Lưu yêu cầu và thiết kế trong `.swarm/specs/` và `docs/notes/` để worker đọc theo nhu cầu thay vì lặp lại trong hội thoại.
  - **Prompt gọn theo vùng sở hữu:** Mỗi worker chỉ nhận đường dẫn sở hữu, tiêu chí nghiệm thu và lệnh kiểm chứng của riêng mình.
  - **Không poll lặp lại:** Dùng cơ chế thông báo sự kiện (reactive wakeup) khi subagent/worker hoàn tất.
  - **Giữ `AGENTS.md` <= 60 dòng và tải skill theo ngữ cảnh:** Chuyển quy trình chi tiết vào `.claude/skills/headless-proof/SKILL.md`.

---

## 6. Thay đổi cho lần sau

- **Kiểm tra thị giác ngay từ Phase 1:** Chuẩn bị sẵn bước mở trình duyệt / chụp ảnh màn hình (`docs/proof/screens/`) ở cuối mỗi phase để bắt sớm lỗi camera, bố cục và văn bản UI.
- **Chốt tag sau khi `verify` và review đều xanh:** Chỉ gắn tag `phase-N` và tạo Release sau khi toàn bộ mã, bằng chứng (`bench.json`, `soak.json`) và tài liệu đã hợp nhất hoàn chỉnh.
- **Quét đồng bộ phiên bản/tiêu đề mỗi phase:** Thêm kiểm tra nhanh tiêu đề `index.html`, `CREDITS.md`, `README.md` và `game.contract.json` mỗi khi nâng phiên bản Contract.
- **Duy trì review độc lập trước mỗi mốc giao nộp:** Đưa bước review chéo `sim ↔ client` thành quy trình bắt buộc ở mọi phase có thay đổi giao diện hoặc công thức tính điểm.
