# MCP host templates

Các file trong thư mục này là template local stdio, không phải cấu hình host đã được áp dụng tự động. Chúng dùng command node và placeholder đường dẫn tới server:

`<TYPESAFE_MCP_ROOT>\\src\\index.mjs`

1. Sao chép phần phù hợp vào cấu hình host tương ứng.
2. Thay REPLACE_WITH_TYPESAFE_API_KEY bằng key trong file cấu hình local/secret store; không commit key.
3. Thay `<TYPESAFE_MCP_ROOT>` bằng đường dẫn local của checkout này.
4. Giữ TYPESAFE_BASE_URL là API root HTTPS. Chỉ dùng HTTP với loopback mock.
5. Chạy npm install và npm test trong project trước khi kết nối host.
6. Kiểm tra host đã thương lượng MCP modern hay legacy; cả hai đều được test trong project.

Các template:

- claude-desktop.json: block mcpServers cho Claude Desktop.
- claude-code.mcp.json: block .mcp.json cho Claude Code.
- codex.toml: block mcp_servers cho Codex CLI/config TOML.
- opencode.json: block mcp local cho OpenCode.

Host có thể dùng tên field khác theo phiên bản. Hãy xác nhận schema của host trước khi ghi cấu hình thật; không sửa cấu hình host trong bước build này. Tất cả template đều chạy local stdio, chưa phải remote HTTP.

system-one-call.json là arguments mẫu cho tool duy nhất; server sẽ validate trước khi gọi TypeSafe.
