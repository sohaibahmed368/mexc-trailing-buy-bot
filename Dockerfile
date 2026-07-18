# Use official lightweight Node.js Alpine image
FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package files for dependency installation
COPY package.json ./
COPY backend/package.json ./backend/

# Install dependencies (ignoring dev dependencies for smaller size)
RUN npm install --omit=dev
RUN cd backend && npm install --omit=dev

# Copy backend files
COPY backend/ ./backend/

# Copy pre-compiled frontend production build
COPY frontend/dist/ ./frontend/dist/

# Expose backend server port
EXPOSE 3001

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Start the application
CMD ["node", "backend/server.js"]
