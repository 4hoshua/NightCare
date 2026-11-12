{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
    in
    {

      devShells.${system}.default = pkgs.mkShell {
        shellHook = ''
          unset MQTT_BACKEND_PASSWORD

          # Uso: nc status | nc "events?limit=20"
          nc() {
            curl -fsS \
              "http://127.0.0.1:3000/api/$1"
          }
        '';
        packages = [
          pkgs.docker
          pkgs.docker-compose
          pkgs.openssl
          pkgs.curl
          pkgs.python3
          pkgs.bash
          pkgs.bore-cli
          pkgs.platformio
        ];
      };
    };
}
