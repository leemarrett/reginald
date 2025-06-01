FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code and .env file
COPY . .

# Start the application
CMD ["npm", "start"] 