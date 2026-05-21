const express = require("express");
const app = express();
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

app.use(cors());

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
    await client.connect();
    const db = client.db("wanderlust");

    const cursorData = db.collection("cursor");

    app.get("/cursor", async (req, res) => {
      const cursor = cursorData.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get(
      "/cursor/:id",

      async (req, res) => {
        const id = req.params.id;

        const query = { _id: new ObjectId(id) };

        const result = await cursorData.findOne(query);

        res.send(result);
      },
    );

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } catch (error) {
    console.log(error);
  }
};

run();

app.get("/", async (req, res) => {
  res.send("Hello world");
});

app.listen(port, () => {
  console.log(`Prot is rouning now ${port}`);
});
