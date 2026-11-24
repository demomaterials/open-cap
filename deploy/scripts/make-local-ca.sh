#!/usr/bin/env bash
# Self-signed root CA + server certificate for the CAP host (local clusters).
#
#   ./make-local-ca.sh             # HOST=cap.bupasec.com
#   ./make-local-ca.sh --apply     # also (re)create Secret cap-tls in namespace cap
#
# Output in scripts/local-ca/ (gitignored, contains private keys):
#   ca.crt / ca.key        root CA (10 years) — trust ca.crt once in your OS/browser
#   server.crt / .key      <HOST> + *.<parent domain> (825 days)
set -euo pipefail

HOST="${HOST:-cap.bupasec.com}"
PARENT="${HOST#*.}"
NAMESPACE="${NAMESPACE:-cap}"
SECRET_NAME="${SECRET_NAME:-cap-tls}"
DIR="$(cd "$(dirname "$0")" && pwd)/local-ca"
mkdir -p "$DIR"
cd "$DIR"

if [[ ! -f ca.key ]]; then
  echo "creating root CA in $DIR"
  openssl genrsa -out ca.key 4096 2>/dev/null
  openssl req -x509 -new -key ca.key -sha256 -days 3650 -out ca.crt \
    -subj "/O=open-cap Local/CN=open-cap Local Dev CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
else
  echo "reusing root CA in $DIR"
fi

openssl genrsa -out server.key 2048 2>/dev/null
openssl req -new -key server.key -out server.csr -subj "/O=open-cap/CN=${HOST}"
cat > server.ext <<EXT
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:${HOST},DNS:*.${PARENT}
EXT
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 825 -sha256 -extfile server.ext 2>/dev/null
cat server.crt ca.crt > server-chain.crt
rm -f server.csr server.ext
echo "issued server certificate for ${HOST}, *.${PARENT}"

if [[ "${1:-}" == "--apply" ]]; then
  kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl -n "$NAMESPACE" create secret tls "$SECRET_NAME" --cert=server-chain.crt --key=server.key \
    --dry-run=client -o yaml | kubectl apply -f -
fi

cat <<MSG

Trust the CA (macOS, once):
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$DIR/ca.crt"
Resolve the host locally (once):
  echo "127.0.0.1 ${HOST}" | sudo tee -a /etc/hosts
MSG
