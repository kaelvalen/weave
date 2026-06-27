let
  pkgs = import <nixpkgs> { };
in
pkgs.mkShell {
  nativeBuildInputs = with pkgs; [
    pkg-config
    wrapGAppsHook4
    gobject-introspection
    cargo
    cargo-tauri
    nodejs
    rustc
  ];

  buildInputs = with pkgs; [
    librsvg
    webkitgtk_4_1
    libsoup_3
    gtk3
    glib
    cairo
    pango
    atk
    gdk-pixbuf
    harfbuzz
    openssl
    dbus
  ];

  shellHook = ''
    export XDG_DATA_DIRS="$GSETTINGS_SCHEMAS_PATH"
  '';
}
