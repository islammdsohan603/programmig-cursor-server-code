const express = require("express");
const app = express();
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

app.use(cors());
app.use(express.json());

const port = process.env.PORT;

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const run = async () => {
  try {
    // await client.connect();

    const db = client.db("wanderlust");

    const cursorData = db.collection("cursor");

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
