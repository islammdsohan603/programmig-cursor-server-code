const express = require("express");
const app = express();
const cors = require("cors");
const dotenv = require("dotenv");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const jwt = require("jsonwebtoken");
const session = require("express-session");

dotenv.config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

app.use(
  cors({
    origin: [process.env.CLIENT_URL, "http://localhost:3000"],
    credentials: true,
  }),
);
app.use(express.json());

app.use(
  session({
    secret: process.env.BETTER_AUTH_SECRET,
    resave: false,
    saveUninitialized: true,
  }),
);
app.use(passport.initialize());
app.use(passport.session());

const port = process.env.PORT;

const uri = process.env.MONGO_URI;
const dbName = "wanderlust";
const coursesCollectionName = "cursor";

let client;
let clientPromise;

const connectClient = async () => {
  if (!uri) {
    throw new Error("MONGO_URI is not configured");
  }

  if (!client) {
    client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
  }

  if (!clientPromise) {
    clientPromise = client.connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }

  return clientPromise;
};

const getDb = async () => {
  const connectedClient = await connectClient();
  return connectedClient.db(dbName);
};

const getCoursesCollection = async () => {
  const db = await getDb();
  return db.collection(coursesCollectionName);
};

const googleAuthReady =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;

if (googleAuthReady) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${process.env.SERVER_URL || "http://localhost:5000"}/auth/google/callback`,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const usersCollection = await getCoursesCollection();

          const user = {
            googleId: profile.id,
            name: profile.displayName,
            email: profile.emails?.[0]?.value,
            photo: profile.photos?.[0]?.value,
            lastLogin: new Date(),
          };

          const result = await usersCollection.findOneAndUpdate(
            { googleId: profile.id },
            { $set: user },
            { upsert: true, returnDocument: "after" },
          );

          return done(null, result.value);
        } catch (error) {
          return done(error, null);
        }
      },
    ),
  );
}

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const usersCollection = await getCoursesCollection();
    const user = await usersCollection.findOne({ _id: new ObjectId(id) });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

if (googleAuthReady) {
  app.get(
    "/auth/google",
    passport.authenticate("google", {
      scope: ["profile", "email"],
    }),
  );

  app.get(
    "/auth/google/callback",
    passport.authenticate("google", {
      failureRedirect: `${process.env.CLIENT_URL || "http://localhost:3000"}/login`,
    }),
    (req, res) => {
      const token = jwt.sign(
        {
          userId: req.user._id,
          email: req.user.email,
          name: req.user.name,
        },
        process.env.BETTER_AUTH_SECRET,
        { expiresIn: "7d" },
      );

      res.redirect(
        `${process.env.CLIENT_URL || "http://localhost:3000"}/dashboard?token=${token}`,
      );
    },
  );
} else {
  app.get("/auth/google", (req, res) => {
    res.status(500).send("Google login is not configured");
  });
}

app.get("/auth/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }
    res.json({ success: true, message: "Logged out successfully" });
  });
});

app.get("/auth/me", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json(req.user);
});

app.get("/", (req, res) => {
  res.send({
    success: true,
    message: "Server is running",
  });
});

app.get("/health/db", async (req, res) => {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });

    res.send({
      success: true,
      message: "MongoDB connection is healthy",
      database: dbName,
      collection: coursesCollectionName,
    });
  } catch (error) {
    res.status(500).send({
      success: false,
      message: "MongoDB connection failed",
      database: dbName,
      collection: coursesCollectionName,
      error: error.message,
    });
  }
});

app.get("/cursor", async (req, res) => {
  try {
    const cursorData = await getCoursesCollection();
    const result = await cursorData.find().toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

app.get("/cursor/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: "Invalid course id" });
    }

    const cursorData = await getCoursesCollection();
    const query = { _id: new ObjectId(id) };

    const result = await cursorData.findOne(query);

    res.send(result);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Port is running now ${port}`);
  });
}

module.exports = app;
