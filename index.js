import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import jwt from "jsonwebtoken";
import session from "express-session";
import Stripe from "stripe";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";

dotenv.config();

const app = express();

// ✅ Stripe initialize

// ✅ CORS setup
app.use(
  cors({
    origin: [process.env.CLIENT_URL, "http://localhost:3000"],
    credentials: true,
  })
);

app.use(express.json());

// ✅ Session setup
app.use(
  session({
    secret: process.env.BETTER_AUTH_SECRET,
    resave: false,
    saveUninitialized: false, // false করা ভালো practice
  })
);

app.use(passport.initialize());
app.use(passport.session());

const port = process.env.PORT || 5000;

// ==================== MongoDB ====================

const uri = process.env.MONGO_URI;
const dbName = "wanderlust";
const coursesCollectionName = "cursor";
const usersCollectionName = "users"; // ✅ আলাদা users collection

let client;
let clientPromise;
let stripeClient;

const createApiError = (message, error, extra = {}) => ({
  success: false,
  message,
  error: error?.message || String(error),
  ...extra,
});

const getStripeClient = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }

  return stripeClient;
};

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

// ✅ Courses collection
const getCoursesCollection = async () => {
  const db = await getDb();
  return db.collection(coursesCollectionName);
};

// ✅ Users collection (আলাদা)
const getUsersCollection = async () => {
  const db = await getDb();
  return db.collection(usersCollectionName);
};

// ==================== Google Auth ====================

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
          // ✅ users collection ব্যবহার করা হচ্ছে
          const usersCollection = await getUsersCollection();

          const user = {
            googleId: profile.id,
            name: profile.displayName,
            email: profile.emails?.[0]?.value,
            photo: profile.photos?.[0]?.value,
            lastLogin: new Date(),
          };

          // ✅ result.value এর বদলে সরাসরি result
          const result = await usersCollection.findOneAndUpdate(
            { googleId: profile.id },
            { $set: user },
            { upsert: true, returnDocument: "after" }
          );

          return done(null, result);
        } catch (error) {
          return done(error, null);
        }
      }
    )
  );
}

// ✅ serializeUser - users collection থেকে
passport.serializeUser((user, done) => {
  done(null, user._id);
});

// ✅ deserializeUser - users collection থেকে
passport.deserializeUser(async (id, done) => {
  try {
    const usersCollection = await getUsersCollection();
    const user = await usersCollection.findOne({ _id: new ObjectId(id) });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// ==================== Auth Routes ====================

if (googleAuthReady) {
  app.get(
    "/auth/google",
    passport.authenticate("google", {
      scope: ["profile", "email"],
    })
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
        { expiresIn: "7d" }
      );

      res.redirect(
        `${process.env.CLIENT_URL || "http://localhost:3000"}/dashboard?token=${token}`
      );
    }
  );
} else {
  app.get("/auth/google", (req, res) => {
    res.status(500).json({ error: "Google login is not configured" });
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

// ==================== General Routes ====================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Server is running",
  });
});

app.get("/health/db", async (req, res) => {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });

    res.json({
      success: true,
      message: "MongoDB connection is healthy",
      database: dbName,
      collection: coursesCollectionName,
    });
  } catch (error) {
    res.status(500).json({
      ...createApiError("MongoDB connection failed", error),
      database: dbName,
      collection: coursesCollectionName,
    });
  }
});

// ==================== Course Routes ====================

app.get("/cursor", async (req, res) => {
  try {
    const cursorData = await getCoursesCollection();
    const result = await cursorData.find().toArray();
    res.json(result);
  } catch (error) {
    res.status(500).json(
      createApiError("Course data could not be loaded", error, {
        database: dbName,
        collection: coursesCollectionName,
      })
    );
  }
});

app.get("/cursor/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid course id" });
    }

    const cursorData = await getCoursesCollection();
    const result = await cursorData.findOne({ _id: new ObjectId(id) });

    if (!result) {
      return res.status(404).json({ error: "Course not found" });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json(
      createApiError("Course details could not be loaded", error, {
        database: dbName,
        collection: coursesCollectionName,
      })
    );
  }
});

// ==================== Stripe Checkout ====================

app.post("/checkout", async (req, res) => {
  try {
    const { product } = req.body;

    // ✅ Validation
    if (!product?.name || !product?.price) {
      return res
        .status(400)
        .json({ error: "Product name এবং price দরকার" });
    }

    if (product.price <= 0) {
      return res
        .status(400)
        .json({ error: "Price অবশ্যই 0 এর বেশি হতে হবে" });
    }

    // ✅ শুধু https image Stripe accept করে, localhost না
    const validImage =
      product.image &&
        product.image.startsWith("https") &&
        !product.image.includes("localhost")
        ? [product.image]
        : [];

    // ✅ variable নাম stripeSession করা হয়েছে (session এর সাথে conflict এড়াতে)
    const stripe = getStripeClient();
    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: product.name,
              images: validImage,
            },
            unit_amount: Math.round(product.price * 100), // ✅ Math.round দিয়ে নিরাপদ
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.CLIENT_URL}/success`,
      cancel_url: `${process.env.CLIENT_URL}/cancel`,
    });

    res.json({ url: stripeSession.url });
  } catch (error) {
    console.error("Stripe error:", error);
    res.status(500).json(createApiError("Checkout could not be started", error));
  }
});

// ==================== Server Start ====================

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

export default app;
