ARG BUILD_FROM
FROM ${BUILD_FROM}

RUN apk add --no-cache gcc musl-dev libffi-dev nodejs npm py3-opencv ffmpeg

# Backend deps
COPY backend/requirements.txt /app/backend/
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Frontend build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --silent
COPY frontend/ .
RUN npm run build
RUN mkdir -p /app/frontend/dist && cp -r dist/. /app/frontend/dist/

# App
COPY backend/ /app/backend/
COPY rootfs/ /
RUN chmod +x /etc/services.d/pihaalpr/run

WORKDIR /app
EXPOSE 8090
