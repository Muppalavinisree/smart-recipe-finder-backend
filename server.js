import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import cors from "cors";

dotenv.config();
const app = express();
app.use(
  cors({
    origin: [
      "http://localhost:5173", // local dev
      "https://smart-recipe-finder-frontend.onrender.com" // deployed frontend
    ],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Fetch meals from MealDB
async function getMealsFromAPI(keyword) {
  try {
    const { data } = await axios.get(
      `https://www.themealdb.com/api/json/v1/1/search.php?s=${keyword}`
    );
    return data.meals ? data.meals.slice(0, 5) : [];
  } catch (e) {
    console.error("MealDB error:", e.message);
    return [];
  }
}

// Fetch ingredients for a given meal
async function getIngredientsFromAPI(mealName) {
  try {
    const { data } = await axios.get(
      `https://www.themealdb.com/api/json/v1/1/search.php?s=${mealName}`
    );
    if (data.meals && data.meals[0]) {
      const meal = data.meals[0];
      const ingredients = [];

      for (let i = 1; i <= 20; i++) {
        const ingredient = meal[`strIngredient${i}`];
        const measure = meal[`strMeasure${i}`];
        if (ingredient) ingredients.push(`- ${measure || ""} ${ingredient}`.trim());
      }

      return `
🍽️ **${meal.strMeal}**
### 🧂 Ingredients
${ingredients.join("\n")}

🔗 [See image](${meal.strMealThumb})
`;
    }
    return "❌ Sorry, I couldn’t find ingredients for that meal.";
  } catch (err) {
    console.error("Ingredient fetch error:", err.message);
    return "⚠️ Error fetching ingredients.";
  }
}

// Root route
app.get("/", (req, res) => {
  res.send("🍳 Smart Recipe Assistant backend running with Gemini 2.5 Flash!");
});

// Chat route
app.post("/api/chat", async (req, res) => {
  try {
    console.log("📩 Received prompt:", req.body);  // 👈 Add this line

    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Missing 'prompt' in request body" });
    }




    const msg = prompt.toLowerCase();

    //  Case 1: Asking for ingredients
    if (msg.includes("ingredient")) {
      const mealName = msg
        .replace(
          /ingredients needed to make|ingredients to make|ingredient of|ingredients for|ingredient/i,
          ""
        )
        .trim();

      const ingredientReply = await getIngredientsFromAPI(mealName);

      // If not found, fallback to Gemini
      if (ingredientReply.startsWith("❌") || ingredientReply.startsWith("⚠️")) {
        const aiResponse = await axios.post(
          `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            contents: [
              {
                parts: [
                  {
                    text: `List the ingredients required to make ${mealName}. Format them as Markdown bullet points.`,
                  },
                ],
              },
            ],
          },
          { headers: { "Content-Type": "application/json" } }
        );

        const botReply =
          aiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
          "Sorry, I couldn’t find the ingredients.";
        return res.json({ reply: botReply });
      }

      return res.json({ reply: ingredientReply });
    }

    //  Case 2: Asking "how to make ..."
    if (msg.includes("how to make")) {
      const mealName = msg.replace(/how to make|how can i make|make/i, "").trim();

      const aiResponse = await axios.post(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          contents: [
            {
              parts: [
                {
                  text: `
Give me a detailed, **Markdown-formatted** step-by-step recipe for ${mealName}.
Include:
1️⃣ Ingredients
2️⃣ Step-by-step cooking instructions
3️⃣ Optional chef tips
Keep it friendly and concise.`,
                },
              ],
            },
          ],
        },
        { headers: { "Content-Type": "application/json" } }
      );

      const botReply =
        aiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "Sorry, I couldn’t find how to make that dish.";
      return res.json({ reply: botReply });
    }

    //  Case 3: Detect general food keywords → show suggestions
    const keywords = ["paneer", "chicken", "egg", "rice", "dessert", "pasta", "vegan"];
    const key = keywords.find((k) => msg.includes(k));
    if (key) {
      const meals = await getMealsFromAPI(key);
      if (meals.length > 0) {
        const list = meals.map((m) => `🍴 ${m.strMeal}`).join("\n");
        return res.json({ reply: `Here are some ${key} dishes:\n${list}` });
      }
    }

    // Case 4: Fallback — Gemini handles any other query
    const aiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { headers: { "Content-Type": "application/json" } }
    );

    const botReply =
      aiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sorry, I couldn’t generate a response.";
    res.json({ reply: botReply });
 } catch (err) {
  console.error("❌ Server Error (Full):", err.response?.data || err.message);
  res.status(500).json({ error: "Failed to fetch AI response" });
}

});

//Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`✅ Smart Recipe Assistant (Gemini 2.5 Flash) running on port ${PORT}`)
);
