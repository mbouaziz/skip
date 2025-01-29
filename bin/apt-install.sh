#!/bin/bash

set -e

default_steps=(llvm node)

usage() {
    echo "Usage: $0 step*"
    echo "  step is one of llvm, node, othertools"
    echo "  default steps are: ${default_steps[*]}"
}

if [ $# -eq 0 ]; then
    steps=("${default_steps[@]}")
else
    steps=("$@")
fi

for step in "${steps[@]}"; do
    case "$step" in
        llvm)
            LLVM_VERSION=15

            apt-get update
            apt-get install -q -y wget gnupg lsb-release software-properties-common
            wget -O - https://apt.llvm.org/llvm.sh | bash -s -- $LLVM_VERSION # This runs apt-get update
            apt-get install -q -y automake clang-$LLVM_VERSION clang-format-$LLVM_VERSION curl file gawk gcc git jq lld-$LLVM_VERSION llvm-$LLVM_VERSION make parallel unzip zip

            update-alternatives --install /usr/bin/clang clang /usr/bin/clang-$LLVM_VERSION 100
            update-alternatives --install /usr/bin/clang++ clang++ /usr/bin/clang++-$LLVM_VERSION 100
            update-alternatives --install /usr/bin/clang-format clang-format /usr/bin/clang-format-$LLVM_VERSION 100
            update-alternatives --install /usr/bin/llc llc /usr/bin/llc-$LLVM_VERSION 100
            update-alternatives --install /usr/bin/llvm-ar llvm-ar /usr/bin/llvm-ar-$LLVM_VERSION 100
            update-alternatives --install /usr/bin/llvm-config llvm-config /usr/bin/llvm-config-$LLVM_VERSION 100
            update-alternatives --install /usr/bin/llvm-link llvm-link /usr/bin/llvm-link-$LLVM_VERSION 100
            update-alternatives --install /usr/bin/wasm-ld wasm-ld /usr/bin/wasm-ld-$LLVM_VERSION 100
            ;;
        node)
            wget -O - https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | apt-key add -
            echo "deb https://deb.nodesource.com/node_22.x nodistro main" >> /etc/apt/sources.list.d/nodejs.list
            apt-get install -q -y nodejs
            npm install -g bun
            npm install -g prettier
            ;;
        othertools)
            apt-get install -q -y pip shellcheck
            pip install black
            ;;
        *)
            echo "Unknown step $step"
            usage
            exit 1
    esac
done
