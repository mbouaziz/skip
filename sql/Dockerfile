FROM skiplabs/skip AS base

RUN apt-get install -q -y curl sqlite3 unzip zip
RUN npm install -g bun
RUN npx playwright install-deps

# SDKMAN installation with checksum verification
# No apt repository available for SDKMAN, so we verify the script checksum
# To update: curl -sL "https://get.sdkman.io?rcupdate=false" | sha256sum
ARG SDKMAN_CHECKSUM=1a71a64db7040e3ab5d8aed3792019ab35d959fd1a66e13b3e9c827e7aa5e1f8
RUN curl -sL "https://get.sdkman.io?rcupdate=false" -o /tmp/sdkman.sh && \
    echo "${SDKMAN_CHECKSUM}  /tmp/sdkman.sh" | sha256sum -c - && \
    bash /tmp/sdkman.sh && \
    rm /tmp/sdkman.sh
RUN bash -c "source $HOME/.sdkman/bin/sdkman-init.sh && \
    sdk install gradle && \
    sdk install java 20.0.2-tem"

FROM base AS skdb

COPY . /skdb

WORKDIR /skdb

RUN make clean && make -C skiplang/compiler clean && make build/skdb && make build/init.sql
