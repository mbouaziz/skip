# Pin Ubuntu version for reproducibility
FROM ubuntu:22.04

# Install dependencies and add Node.js apt repository directly
# This avoids executing downloaded scripts (supply chain security)
# GPG key source: https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key
ARG NODE_MAJOR=22
RUN apt-get update --quiet && \
    apt-get install --quiet --yes ca-certificates curl gnupg g++ make python3 wget && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update --quiet && \
    apt-get install --quiet --yes nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    npm install --global typescript

# copy the npm pack archives, libskipruntime.so files, and install_runtime.sh
COPY build /work/build

# copy the test code
COPY package.json test.ts /work/

WORKDIR /work

# set installation prefix
ENV PREFIX=/usr/local

# calculate the version of the skipruntime
#   use `npm install --dry-run` (instead of e.g. `npm view`) to respect any version constraints in package.json
RUN VERSION=$(npm install --dry-run @skipruntime/native | grep native | cut -d' ' -f3) \
# specify to obtain the binary release from a local directory
    SOURCE="file:///work/build" \
# specify the installation prefix
    PREFIX=${PREFIX} \
# install the skipruntime binary release
    build/install_runtime.sh \
# install the skipruntime native node addon package
 && npm install @skipruntime/native

# build the test
RUN npm install \
 && tsc --module node16 test.ts

# set LD_LIBRARY_PATH so node can find the native addon's shared object file
ENV LD_LIBRARY_PATH=${PREFIX}/lib

# run the test
CMD ["node", "test.js"]
