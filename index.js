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

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Passport Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.SERVER_URL || "http://localhost:5000"}/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const db = client.db("wanderlust");
        const usersCollection = db.collection("users");

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

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const db = client.db("wanderlust");
    const usersCollection = db.collection("users");
    const user = await usersCollection.findOne({ _id: new ObjectId(id) });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

const run = async () => {
  try {
    await client.connect();

    const db = client.db("wanderlust");

    const cursorData = db.collection("cursor");

    // Google Auth Routes
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
        // Generate JWT Token
        const token = jwt.sign(
          {
            userId: req.user._id,
            email: req.user.email,
            name: req.user.name,
          },
          process.env.BETTER_AUTH_SECRET,
          { expiresIn: "7d" },
        );

        // Redirect to frontend with token
        res.redirect(
          `${process.env.CLIENT_URL || "http://localhost:3000"}/dashboard?token=${token}`,
        );
      },
    );

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

    app.get("/cursor", async (req, res) => {
      const result = await cursorData.find().toArray();

      res.send(result);
    });

    app.get("/cursor/:id", async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) };

      const result = await cursorData.findOne(query);

      res.send(result);
    });

    console.log("MongoDB Connected Successfully");
  } catch (error) {
    console.log(error);
  }
};

run();

app.get("/", (req, res) => {
  res.send({
    success: true,
    message: "Server is running",
  });
});

app.listen(port, () => {
  console.log(`Port is running now ${port}`);
});
