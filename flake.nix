# Fork-only: NixOS dev shell for building and running Orca from source.
#
# Orca's pnpm install downloads a stock Electron binary and rebuilds native
# modules against it. Neither runs on NixOS without a conventional /usr/lib, so
# the shell is a buildFHSEnv carrying Node 24 (package.json "engines"), a C
# toolchain for node-gyp, and Electron's runtime libraries. pnpm itself comes
# from corepack, pinned by package.json "packageManager".
#
#   nix develop          # enter the FHS shell
#   pnpm install --frozen-lockfile
#   pnpm dev
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
      fhs = pkgs.buildFHSEnv {
        name = "orca-dev";
        targetPkgs =
          p: with p; [
            # build toolchain
            nodejs_24
            gcc
            gnumake
            python3
            pkg-config
            git

            # CLIs the DevOps Toolbelt runs (e.g. floci) link against zlib
            zlib

            # Electron runtime
            glib
            nss
            nspr
            atk
            at-spi2-atk
            at-spi2-core
            cups
            dbus
            libdrm
            gtk3
            pango
            cairo
            expat
            alsa-lib
            mesa
            libgbm
            libGL
            libxkbcommon
            libsecret
            systemd
            libnotify
            libx11
            libxcomposite
            libxdamage
            libxext
            libxfixes
            libxrandr
            libxcb
            libxshmfence
            libxtst
            wayland
          ];
        profile = ''
          export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
          export COREPACK_HOME="$HOME/.cache/orca-dev/corepack"
          mkdir -p "$HOME/.cache/orca-dev/bin"
          corepack enable --install-directory "$HOME/.cache/orca-dev/bin" >/dev/null
          export PATH="$HOME/.cache/orca-dev/bin:$PATH"
          export npm_config_store_dir="$HOME/.cache/orca-dev/pnpm-store"
        '';
        runScript = "zsh";
      };
    in
    {
      devShells.x86_64-linux.default = fhs.env;
      # `nix run . -- -c "<cmd>"` runs one command inside the FHS env.
      packages.x86_64-linux.default = fhs;
    };
}
