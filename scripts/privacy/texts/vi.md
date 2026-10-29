name: Tiếng Việt
title: Chính sách quyền riêng tư
description: Cách viagem xử lý dữ liệu của bạn: những gì nằm trên thiết bị của bạn, những gì đi qua máy chủ phòng, cookie và quảng cáo của Google, và quyền của bạn theo LGPD và GDPR.
updated: Cập nhật ngày 28 tháng 10 năm 2026
back: ← Quay lại trò chơi
note: Đây là bản dịch để thuận tiện; nếu có khác biệt, bản tiếng Bồ Đào Nha có giá trị.
---
## Chúng tôi là ai
**viagem** là một trò chơi hợp tác (co-op) miễn phí chạy trên trình duyệt, tại {site}, do một nhà phát triển độc lập làm ra. Trang này giải thích trò chơi dùng dữ liệu nào, để làm gì và bạn có thể làm gì — theo Luật Chung về Bảo vệ Dữ liệu của Brazil (LGPD, Luật 13.709/2018) và, với người chơi từ châu Âu, theo Quy định Chung về Bảo vệ Dữ liệu (GDPR).

## Những gì chúng tôi không yêu cầu
Trò chơi không có đăng ký. Chúng tôi không yêu cầu e-mail, mật khẩu, số điện thoại, giấy tờ tùy thân hay thông tin thanh toán, và không bán dữ liệu của bất kỳ ai.

## Những gì nằm trên thiết bị của bạn
Để ghi nhớ lựa chọn của bạn, trò chơi lưu vào bộ nhớ cục bộ của trình duyệt (`localStorage`), với các khóa bắt đầu bằng `viagem:`:
- nhân vật, màu sắc và tên nhà thám hiểm bạn đã chọn;
- cài đặt âm thanh, nhạc và rung, mức thu phóng camera, chế độ tiết kiệm và số bot khi chơi một mình;
- các mẹo bạn đã xem, và việc bạn có đồng ý xuất hiện trong “khoảnh khắc xấu hổ” của trận đấu hay không;
- nếu bạn bị đưa ra khỏi một phòng, một dấu tạm thời ngăn bạn quay lại phòng đó cho đến khi hết hạn.
Khi tab còn mở, trò chơi cũng dùng `sessionStorage` (bị xóa khi đóng tab) để giữ chỗ của bạn trong phòng nếu mất kết nối hoặc trang tải lại do cập nhật.
Dữ liệu này ở lại trên thiết bị của bạn và không được gửi cho chúng tôi. Bạn có thể xóa nó bất cứ lúc nào bằng cách xóa dữ liệu trang web trong cài đặt trình duyệt. Trò chơi cũng lưu hình ảnh và âm thanh trong bộ nhớ đệm (service worker) để tải nhanh hơn; bộ nhớ đệm này không chứa dữ liệu nào về bạn.

## Những gì đi qua máy chủ phòng
Khi bạn tham gia một trận đấu, tên nhà thám hiểm, nhân vật và hành động của bạn trong trò chơi được gửi đến máy chủ phòng (lưu trữ trên Cloudflare) và những người chơi khác trong cùng phòng sẽ thấy. Chỉ trong thời gian phòng còn tồn tại, máy chủ giữ tên và nhân vật của từng người chơi, một mã truy cập đã mã hóa (để bạn có thể quay lại chỗ của mình) và tiến trình trận đấu. Mỗi phòng bị xóa hoàn toàn khoảng 50 phút sau khi được tạo; chúng tôi không lưu lịch sử trận đấu hay tài khoản.
Để ngăn lạm dụng, địa chỉ IP chỉ được dùng ngay tại thời điểm đó để giới hạn số phòng có thể tạo mỗi phút; trò chơi không lưu nó. Nhật ký kỹ thuật về kết nối của máy chủ (thời điểm kết nối mở và đóng, độ trễ, lượng dữ liệu) không chứa tên hay IP.

## Lưu trữ và nhật ký kỹ thuật
Trang web được lưu trữ trên GitHub Pages và máy chủ phòng trên Cloudflare. Như mọi trang web, các dịch vụ này nhận dữ liệu kỹ thuật của kết nối (địa chỉ IP, trình duyệt, ngày và giờ) để phân phối trang và tự bảo vệ trước lạm dụng, theo chính sách quyền riêng tư của [GitHub](github) và [Cloudflare](cloudflare).

## Cookie và quảng cáo của Google
Trò chơi được duy trì nhờ quảng cáo **Google AdSense** (H5 Games Ads), chỉ hiển thị giữa các trận đấu, không bao giờ trong lúc chơi. Vì vậy:
- Google và các đối tác dùng cookie và các mã nhận dạng tương tự để hiển thị quảng cáo, giới hạn số lần bạn thấy cùng một quảng cáo, đo lường kết quả và ngăn chặn gian lận.
- Google có thể hiển thị quảng cáo được cá nhân hóa dựa trên các lần bạn truy cập trang này và các trang khác. Xem [cách Google sử dụng thông tin từ các trang web dùng dịch vụ của Google](partners).
- Bạn có thể tắt quảng cáo được cá nhân hóa trong [Cài đặt quảng cáo của Google](adsettings), hoặc của các công ty khác tại [aboutads.info](aboutads). Quảng cáo vẫn hiển thị, nhưng không được cá nhân hóa.
- Người truy cập từ Liên minh châu Âu, Khu vực Kinh tế châu Âu, Vương quốc Anh hoặc Thụy Sĩ sẽ thấy thông báo xin đồng ý của Google (một nền tảng quản lý sự đồng ý được chứng nhận) trước bất kỳ cookie quảng cáo nào. Để thay đổi lựa chọn sau này, hãy dùng liên kết quyền riêng tư và cookie mà thông báo đó để lại trên trang, hoặc xóa cookie của trang trong trình duyệt để thấy lại thông báo.
Chúng tôi chặn quảng cáo cá cược, sòng bạc và các danh mục nhạy cảm khác. Trò chơi vẫn chạy bình thường nếu bạn dùng trình chặn quảng cáo.

## Vì sao chúng tôi dùng dữ liệu này
Chúng tôi dùng dữ liệu trò chơi để trận đấu vận hành (cung cấp dịch vụ bạn yêu cầu). Quảng cáo dựa trên lợi ích hợp pháp là giữ trò chơi miễn phí và, khi luật yêu cầu (như GDPR ở châu Âu, và với cookie quảng cáo được cá nhân hóa), dựa trên sự đồng ý của bạn, mà bạn có thể rút lại bất cứ lúc nào.

## Trẻ em và thanh thiếu niên
Trò chơi có phong cách hoạt hình và không yêu cầu dữ liệu cá nhân nào. Trò chơi không dành cho trẻ dưới 13 tuổi và chúng tôi không cố ý thu thập dữ liệu của trẻ em; nếu cha mẹ hoặc người giám hộ cho rằng một đứa trẻ đã gửi dữ liệu cho chúng tôi, hãy liên hệ và chúng tôi sẽ xóa. Chúng tôi chặn các danh mục quảng cáo không phù hợp.

## Quyền của bạn
Theo LGPD (và GDPR ở châu Âu), bạn có thể yêu cầu xác nhận việc chúng tôi có xử lý dữ liệu của bạn hay không, cũng như quyền truy cập, chỉnh sửa, ẩn danh hóa hoặc xóa, chuyển dữ liệu, thông tin về việc chúng tôi chia sẻ với ai, phản đối và rút lại sự đồng ý. Vì gần như mọi thứ nằm trên thiết bị của chính bạn, trong hầu hết trường hợp chỉ cần xóa dữ liệu trang web trong trình duyệt; dữ liệu phòng tự biến mất khi phòng bị xóa. Với mọi yêu cầu khác, kể cả yêu cầu xóa, hãy dùng liên hệ bên dưới. Bạn cũng có thể khiếu nại với Cơ quan Quốc gia về Bảo vệ Dữ liệu của Brazil ([ANPD](anpd)) hoặc cơ quan bảo vệ dữ liệu tại quốc gia của bạn.

## Liên hệ
Câu hỏi hoặc yêu cầu về quyền riêng tư: viết thư đến {email} hoặc mở một thảo luận tại {issues}.

## Thay đổi
Nếu chính sách này thay đổi, ngày ở đầu trang cũng thay đổi theo.
