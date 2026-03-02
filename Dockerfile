FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    imagemagick \
    webp \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build if necessary (though we are running tsx directly)
# RUN npm run build

# Expose port
EXPOSE 3000

# Start the bot
CMD ["npm", "start"]
