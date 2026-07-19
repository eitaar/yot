#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="${YOT_DATA_DIR:-$HOME/.yot}"
SERVICE_FILE="/etc/systemd/system/yot-server.service"

echo "==> Installing to $DATA_DIR"
mkdir -p "$DATA_DIR"
install -m 755 "$SCRIPT_DIR/yot-server" "$DATA_DIR/yot-server"
install -m 755 "$SCRIPT_DIR/yot-mcp" "$DATA_DIR/yot-mcp"
install -m 755 "$SCRIPT_DIR/yot" "$DATA_DIR/yot"

echo "==> Adding $DATA_DIR to PATH (if needed)"
case ":$PATH:" in
    *":$DATA_DIR:"*) ;;
    *) echo "export PATH=\"$DATA_DIR:\$PATH\"" >> "$HOME/.profile"
       echo "  Added to ~/.profile (restart shell or run: source ~/.profile)" ;;
esac

echo "==> Running yot init"
"$DATA_DIR/yot" init

echo "==> Installing systemd service"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=yot calendar server
After=network.target

[Service]
Type=simple
ExecStart=$DATA_DIR/yot-server
User=$(whoami)
Restart=on-failure
RestartSec=5
Environment=PORT=4010

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now yot-server

echo ""
echo "Done. yot-server is running on port 4010."
echo "  Install dir: $DATA_DIR"
echo "  Logs:        journalctl -u yot-server -f"
echo "  Status:      systemctl status yot-server"
