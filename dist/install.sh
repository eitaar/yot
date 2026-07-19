#!/bin/sh
set -e

REPO="eitaar/yot"
DATA_DIR="${YOT_DATA_DIR:-}"
INSTALL_SERVICE=false

detect_data_dir() {
    if [ -n "$DATA_DIR" ]; then return; fi
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*)
            DATA_DIR="${APPDATA}/yot" ;;
        *)
            DATA_DIR="$HOME/.yot" ;;
    esac
}

detect_platform() {
    OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
    ARCH="$(uname -m)"

    case "$OS" in
        linux)   OS="linux" ;;
        darwin)  OS="darwin" ;;
        mingw*|msys*|cygwin*) OS="windows" ;;
        *)       echo "Unsupported OS: $OS"; exit 1 ;;
    esac

    case "$ARCH" in
        x86_64|amd64)  ARCH="amd64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        *)             echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
}

download_and_install() {
    EXT="tar.gz"
    if [ "$OS" = "windows" ]; then EXT="zip"; fi

    ARCHIVE="yot-${OS}-${ARCH}.${EXT}"
    URL="https://github.com/$REPO/releases/latest/download/$ARCHIVE"

    echo "==> Downloading $ARCHIVE"
    TMPDIR="$(mktemp -d)"
    curl -sSL -o "$TMPDIR/$ARCHIVE" "$URL" || {
        echo "Failed to download $URL"
        echo "Check https://github.com/$REPO/releases for available builds."
        rm -rf "$TMPDIR"
        exit 1
    }

    echo "==> Installing to $DATA_DIR"
    mkdir -p "$DATA_DIR"

    if [ "$EXT" = "zip" ]; then
        unzip -o -q "$TMPDIR/$ARCHIVE" -d "$TMPDIR/extract"
    else
        mkdir -p "$TMPDIR/extract"
        tar xzf "$TMPDIR/$ARCHIVE" -C "$TMPDIR/extract"
    fi

    for bin in yot-server yot-mcp yot; do
        found="$(find "$TMPDIR/extract" -name "$bin" -o -name "$bin.exe" | head -1)"
        if [ -n "$found" ]; then
            cp "$found" "$DATA_DIR/"
            chmod +x "$DATA_DIR/$(basename "$found")"
        fi
    done

    rm -rf "$TMPDIR"
}

add_to_path() {
    case ":$PATH:" in
        *":$DATA_DIR:"*) return ;;
    esac

    SHELL_NAME="$(basename "${SHELL:-/bin/sh}")"
    case "$SHELL_NAME" in
        zsh)  RC="$HOME/.zshrc" ;;
        fish) RC="$HOME/.config/fish/config.fish" ;;
        *)    RC="$HOME/.profile" ;;
    esac

    if [ "$SHELL_NAME" = "fish" ]; then
        echo "set -gx PATH $DATA_DIR \$PATH" >> "$RC"
    else
        echo "export PATH=\"$DATA_DIR:\$PATH\"" >> "$RC"
    fi
    echo "  Added to $RC (restart shell or: source $RC)"
    export PATH="$DATA_DIR:$PATH"
}

install_systemd_service() {
    if [ "$OS" != "linux" ]; then
        echo "  --service is only supported on Linux"
        return
    fi

    SERVICE_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SERVICE_DIR"

    cat > "$SERVICE_DIR/yot-server.service" <<UNIT
[Unit]
Description=yot calendar server
After=network.target

[Service]
Type=simple
ExecStart=$DATA_DIR/yot-server
Restart=on-failure
RestartSec=5
Environment=PORT=4010
Environment=YOT_DATA_DIR=$DATA_DIR

[Install]
WantedBy=default.target
UNIT

    systemctl --user daemon-reload
    systemctl --user enable yot-server
    systemctl --user start yot-server

    echo "  systemd user service enabled and started"
    echo "  Status: systemctl --user status yot-server"
    echo "  Logs:   journalctl --user -u yot-server -f"
}

parse_args() {
    for arg in "$@"; do
        case "$arg" in
            --service) INSTALL_SERVICE=true ;;
        esac
    done
}

main() {
    parse_args "$@"
    detect_data_dir
    detect_platform

    echo "yot installer"
    echo "  Platform: ${OS}/${ARCH}"
    echo "  Install:  ${DATA_DIR}"
    echo ""

    download_and_install
    add_to_path

    echo "==> Running yot init"
    "$DATA_DIR/yot" init

    if [ "$INSTALL_SERVICE" = true ]; then
        echo "==> Installing systemd service"
        install_systemd_service
    fi

    echo ""
    echo "Done! Start the server with:"
    if [ "$INSTALL_SERVICE" = true ]; then
        echo "  (already running as systemd service)"
    else
        echo "  yot-server"
        if [ "$OS" = "linux" ]; then
            echo ""
            echo "To run as a background service:"
            echo "  curl -sSL https://raw.githubusercontent.com/$REPO/main/dist/install.sh | sh -s -- --service"
        fi
    fi
}

main "$@"
