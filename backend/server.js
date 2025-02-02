const express = require("express");
const dotenv = require("dotenv");
const connectDB = require("./utilis/db"); // Ensure the path is correct
const authRoutes = require("./routes/authRoutes"); // Import auth routes
const passport = require("./utilis/passport");
const cors = require("cors"); // Enable CORS for cross-origin requests
const session = require("express-session");
const RedisStore = require("connect-redis")(session); // Redis session store
const redis = require("redis");
const { Vibrant } = require("node-vibrant/node");
const { GoogleProvider, likeVideo, dislikeVideo,likeComment,dislikeComment,postComment, getRefreshedToken } = require("./utilis/googleStrategy");
const fs = require("fs");
const axios = require("axios");
dotenv.config(); // Load environment variables

const app = express();
const PORT = process.env.PORT || 5000;

// Session middleware

const redisClient = redis.createClient({
  host: process.env.REDIS_HOST, // Use your Redis host
  port: process.env.REDIS_PORT, // Use your Redis port
  password: process.env.REDIS_PASSWORD, // Use your Redis password if any
  tls: true, // Optional, for secure Redis connection
});

redisClient.on("error", (err) => {
  console.error("Redis error: ", err);
});


app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: "#$%^&*($%^&*I",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === "production" },
  })
);

// Connect to MongoDB
connectDB();

// Middleware
const corsOptions = {
  origin: "http://localhost:5173", // Allow frontend URL
  methods: "GET,POST",
  credentials: true,
  allowedHeaders: "Content-Type,Authorization",
};
app.use(cors(corsOptions));
app.use(express.json()); // Parse JSON request bodies

// Root route

// Thumbnail color extraction API
app.get("/thumbnail-color", async (req, res) => {
  const imageUrl = req.query.imageUrl; // Get image URL from query parameter

  if (!imageUrl || !imageUrl.startsWith("http")) {
    return res.status(400).json({ error: "A valid image URL is required" });
  }

  try {
    // Fetch the image from the URL
    const response = await axios({ url: imageUrl, responseType: "arraybuffer" });
    const imageBuffer = Buffer.from(response.data);

    // Save the image temporarily for processing
    const tempFilePath = "./temp-image.jpg";
    fs.writeFileSync(tempFilePath, imageBuffer);

    // Extract color palette using Vibrant
    const palette = await Vibrant.from(tempFilePath).getPalette();

    // Clean up temporary file
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    // Fallback for colors if Vibrant swatch is not available
    const vibrantColor = palette.Vibrant
      ? `rgb(${palette.Vibrant.rgb.join(", ")})`
      : palette.DarkVibrant
      ? `rgb(${palette.DarkVibrant.rgb.join(", ")})`
      : null;

    if (vibrantColor) {
      // Generate a gradient using the extracted vibrant color
      const gradient = generateGradient(palette.Vibrant.rgb);
      return res.json({ gradient });
    } else {
      return res.status(404).json({ error: "No vibrant color found" });
    }
  } catch (error) {
    console.error("Error fetching or processing thumbnail:", error.message);
    res.status(500).json({ error: "Error processing image." });
  }
});

// Gradient generation function
function generateGradient(rgb) {
  // Convert RGB to HSL for easier manipulation
  const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);

  // Create lighter and darker shades
  const lighterHsl = { ...hsl, l: Math.min(1, hsl.l + 0.2) };
  const darkerHsl = { ...hsl, l: Math.max(0, hsl.l - 0.2) };

  // Convert HSL back to RGB
  const lighterRgb = hslToRgb(lighterHsl.h, lighterHsl.s, lighterHsl.l);
  const darkerRgb = hslToRgb(darkerHsl.h, darkerHsl.s, darkerHsl.l);

  // Create a linear gradient CSS string
  return `linear-gradient(90deg, rgb(${darkerRgb.join(", ")}) 0%, rgb(${rgb.join(
    ", "
  )}) 50%, rgb(${lighterRgb.join(", ")}) 100%)`;
}

// Function to convert RGB to HSL
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l;
  l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h, s, l };
}

// Function to convert HSL to RGB
function hslToRgb(h, s, l) {
  let r, g, b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// API routes
app.use("/auth", authRoutes);
app.use(passport.initialize());
app.use(passport.session());
passport.use(GoogleProvider);

app.post("/comment",postComment);

app.post('/video/:videoId/like', likeVideo);
app.post("/video/:videoId/dislike",dislikeVideo)
app.post("/comment/like", likeComment);
app.post("/comment/dislike", dislikeComment);
app.post('/refresh-token',getRefreshedToken);
// Global error handler
app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err.message);
  res.status(err.status || 500).json({ message: err.message || "Internal Server Error" });
});

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.get("/", (req, res) => {
  res.status(404).json({ message: "API route found" });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on: http://localhost:${PORT}`);
});
