const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Store health data (replace with database for production)
let healthData = {
  steps: [],
  heartRate: [],
  distance: [],
  activeEnergy: [],
  workout: [],
  sleep: [],
  weight: [],
  bloodPressure: [],
};

let syncHistory = [];
const connectedDevices = new Set();

// WebSocket connections for live updates
wss.on('connection', (ws) => {
  console.log('Dashboard connected via WebSocket');
  connectedDevices.add(ws);
  
  // Send current data to newly connected client
  ws.send(JSON.stringify({
    type: 'initial',
    data: healthData,
    timestamp: new Date().toISOString()
  }));

  ws.on('close', () => {
    connectedDevices.delete(ws);
    console.log('Dashboard disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Broadcast data update to all connected dashboards
function broadcastUpdate(data) {
  const message = JSON.stringify({
    type: 'update',
    data,
    timestamp: new Date().toISOString()
  });

  connectedDevices.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// MARK: - Real-time Sync Endpoint (from iOS app)
app.post('/api/sync', (req, res) => {
  try {
    const incomingData = req.body;
    
    console.log(`📱 Received sync from iPhone - ${new Date().toLocaleTimeString()}`);

    // Process each data type
    Object.keys(incomingData).forEach((key) => {
      const dataPoints = incomingData[key];
      
      if (Array.isArray(dataPoints) && dataPoints.length > 0) {
        // Add new data points (avoiding duplicates by date)
        const existingDates = new Set(
          (healthData[key] || []).map(d => d.startDate)
        );
        
        const newPoints = dataPoints.filter(
          point => !existingDates.has(point.startDate)
        );
        
        if (newPoints.length > 0) {
          healthData[key] = [...(healthData[key] || []), ...newPoints]
            .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
            .slice(0, 1000); // Keep last 1000 entries
          
          console.log(`  ✓ ${key}: ${newPoints.length} new records`);
        }
      }
    });

    // Add to sync history
    syncHistory.push({
      timestamp: new Date(),
      dataTypes: Object.keys(incomingData).filter(k => incomingData[k].length > 0),
      totalRecords: Object.values(incomingData).reduce((sum, arr) => sum + arr.length, 0)
    });

    // Keep last 100 syncs
    syncHistory = syncHistory.slice(-100);

    // Broadcast update to all connected dashboards
    broadcastUpdate(healthData);

    res.json({
      success: true,
      message: 'Data synced successfully',
      syncTime: new Date().toISOString(),
      recordsReceived: Object.values(incomingData).reduce((sum, arr) => sum + arr.length, 0)
    });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Failed to sync data', details: error.message });
  }
});

// MARK: - Data Retrieval Endpoints

app.get('/api/health-data', (req, res) => {
  res.json(healthData);
});

app.get('/api/health-data/:type', (req, res) => {
  const { type } = req.params;
  if (healthData[type]) {
    res.json(healthData[type]);
  } else {
    res.status(404).json({ error: 'Data type not found' });
  }
});

// Get latest value for each metric
app.get('/api/latest', (req, res) => {
  const latest = {};
  
  Object.keys(healthData).forEach((key) => {
    const data = healthData[key];
    if (data.length > 0) {
      latest[key] = data[0]; // Already sorted by startDate descending
    }
  });
  
  res.json(latest);
});

// Get statistics
app.get('/api/stats', (req, res) => {
  const stats = {};
  
  Object.keys(healthData).forEach((key) => {
    const data = healthData[key];
    if (data.length > 0) {
      const values = data.map(d => d.value).filter(v => !isNaN(v));
      
      if (values.length > 0) {
        stats[key] = {
          count: values.length,
          latest: data[0],
          average: (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
          max: Math.max(...values),
          min: Math.min(...values),
          unit: data[0].unit || ''
        };
      }
    }
  });
  
  res.json(stats);
});

// Get sync history
app.get('/api/sync-history', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 20;
  res.json(syncHistory.slice(-limit).reverse());
});

// Get device status
app.get('/api/status', (req, res) => {
  const lastSync = syncHistory[syncHistory.length - 1];
  
  res.json({
    connected: connectedDevices.size > 0,
    dashboardsConnected: connectedDevices.size,
    lastSync: lastSync ? lastSync.timestamp : null,
    totalRecords: Object.values(healthData).reduce((sum, arr) => sum + arr.length, 0),
    dataTypes: Object.keys(healthData).filter(k => healthData[k].length > 0)
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// MARK: - Error Handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// MARK: - Server Start
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════╗
║     HealthKit Real-time Sync Server    ║
╚════════════════════════════════════════╝

🚀 Server running on http://${HOST}:${PORT}
📱 iOS app will sync data every 60 seconds
🌐 Dashboard connects via WebSocket for live updates

Endpoints:
  POST /api/sync          - Receive data from iOS app
  GET  /api/health-data   - Get all health data
  GET  /api/latest        - Get latest values
  GET  /api/stats         - Get statistics
  GET  /api/sync-history  - Get sync history
  GET  /api/status        - Get server status

Ready for connections! ✨
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});