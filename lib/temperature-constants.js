/**
 * Temperature monitoring and outlier detection constants
 * Shared constants for the cron job temperature processing
 */

// Outlier Detection Thresholds
export const SENSOR_OUTLIER_THRESHOLD = 0.17; // 17% deviation from median for individual sensors
export const MIN_SENSORS_FOR_OUTLIER_DETECTION = 2; // Minimum sensors needed for outlier analysis
export const TEMPERATURE_PRECISION_DECIMALS = 1; // Decimal places for temperature rounding

// Notification and Throttling
export const NOTIFICATION_THROTTLE_HOURS = 8; // Hours between outlier notifications
export const CONNECTION_TIMEOUT_MS = 5000; // Timeout for Arduino sensor connections
export const SILENCE_DURATION_HOURS = 2; // Hours to wait before logging errors for failed connections

// Sensor Configuration
export const SENSOR_KEYS = ['z0', 'z1', 'z2', 'z3'];
export const SENSOR_LABELS = {
  z0: 'Top Left',
  z1: 'Top Right',
  z2: 'Bottom Left',
  z3: 'Bottom Right'
};

// Note: Process status and collection names are kept as string literals
// for better flexibility and database migration compatibility