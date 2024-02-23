// index.js
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const cloudinary = require("cloudinary").v2;
const axios = require("axios");

const app = express();

// CONFIGURE CLOUDINARY
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet());
app.use(cors());
app.use(morgan("tiny"));

app.get("/", (req, res) => {
  res.status(200).json({ message: "FabricJS JSON to PDF Server" });
});

app.post("/fabric/convert-to-pdf", async (req, res) => {
  const { fabricJSON } = req.body;

  const tempFilePath = "output.pdf";

  // Create a new PDF document
  const doc = new PDFDocument();
  const stream = fs.createWriteStream(tempFilePath);
  doc.pipe(stream);

  const drawImage = async (obj) => {
    const response = await axios.get(obj.src, {
      responseType: "arraybuffer",
    });
    const buffer = Buffer.from(response.data, "binary");

    // const buffer = await response.buffer();
    doc.image(buffer, obj.left, obj.top, {
      width: obj.width * obj.scaleX,
      height: obj.height * obj.scaleY,
    });
  };

  // Function to draw objects on the PDF
  const drawObjects = async (objects) => {
    // Use Promise.all to wait for all async operations to complete
    await Promise.all(
      objects.map((obj) => {
        switch (obj.type) {
          case "circle":
            doc
              .circle(
                obj.left + obj.radius,
                obj.top + obj.radius,
                obj.radius * obj.scaleX
              )
              .fill(obj.fill);
            return Promise.resolve();
          case "rect":
            doc
              .rect(
                obj.left,
                obj.top,
                obj.width * obj.scaleX,
                obj.height * obj.scaleY
              )
              .fill(obj.fill);
            return Promise.resolve();
          case "triangle":
            const height = obj.height * obj.scaleY;
            const baseHalf = (obj.width * obj.scaleX) / 2;
            doc
              .path(
                `M${obj.left},${obj.top + height} L${obj.left + baseHalf},${
                  obj.top
                } L${obj.left + baseHalf * 2},${obj.top + height} Z`
              )
              .fill(obj.fill);
            return Promise.resolve();
          case "textbox":
            doc
              .fontSize(obj.fontSize * Math.min(obj.scaleX, obj.scaleY))
              .font("Helvetica") // Using a built-in font
              .fillColor(obj.fill)
              .text(obj.text, obj.left, obj.top, {
                width: obj.width * obj.scaleX,
                align: obj.textAlign,
              });
            return Promise.resolve();
          case "image":
            return drawImage(obj);
          default:
            console.log(`Unsupported object type: ${obj.type}`);
            return Promise.resolve();
        }
      })
    );
  };

  // Assuming fabricJSON is already parsed from JSON string to object
  if (fabricJSON.background) {
    doc
      .fillColor(fabricJSON.background)
      .rect(0, 0, doc.page.width, doc.page.height)
      .fill();
  }

  // Draw objects
  await drawObjects(fabricJSON.objects);

  // Finalize the PDF and end the stream
  doc.end();

  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  try {
    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(tempFilePath, {
      resource_type: "raw",
      type: "upload",
    });

    // Delete the temporary file after upload
    fs.unlinkSync(tempFilePath);

    // Respond with the URL of the uploaded file
    res.status(200).json(result.secure_url);
  } catch (error) {
    console.error("Error uploading PDF to Cloudinary:", error);
    // Ensure you delete the temporary file even if the upload fails
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    res.status(500).json({ error: "Error uploading PDF" });
  }
});

// Error handling
app.use((req, res, next) => {
  res.status(404).send("Resource not found");
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.name, message: err.message });
});

// Server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
