#!/bin/sh
set -e

BIN_DIR="/usr/local/bin"
SERVICE_FILE="/etc/systemd/system/yot-server.service"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing binaries to $BIN_DIR"
install -m 755 "$SCRIPT_DIR/yot-server" "$BIN_DIR/yot-server"
install -m 755 "$SCRIPT_DIR/yot-mcp" "$BIN_DIR/yot-mcp"
install -m 755 "$SCRIPT_DIR/yot" "$BIN_DIR/yot"

echo "==> Running yot init"
sudo -u "${SUDO_USER:-$USER}" yot init

echo "==> Installing systemd service"
cp "$SCRIPT_DIR/yot-server.service" "$SERVICE_FILE"

if [ -n "$SUDO_USER" ]; then
    sed -i "s|^ExecStart=.*|ExecStart=$BIN_DIR/yot-server|" "$SERVICE_FILE"
    cat >> "$SERVICE_FILE" <<EOF

# Run as the installing user
[Service]
User=$SUDO_USER
EOF
fi

systemctl daemon-reload
systemctl enable --now yot-server

echo ""
echo "Done. yot-server is running on port 4010."
echo "  Logs:   journalctl -u yot-server -f"
echo "  Status: systemctl status yot-server"
