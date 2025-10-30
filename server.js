import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import cors from "cors";
import stringSimilarity from "string-similarity";

dotenv.config();
const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://codesandbox.io/p/github/Muppalavinisree/smart-recipe-finder-frontend",
      "https://codesandbox.io",
    ],
  })
);

app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

//  Local Recipe Database
const localRecipes = [
  {
    name: "Chicken Biryani",
    keywords: ["chicken", "rice", "biryani"],
    ingredients: [
      "2 cups basmati rice",
      "500g chicken",
      "2 onions (sliced)",
      "2 tomatoes (chopped)",
      "1 cup curd",
      "Spices: garam masala, chili powder, turmeric, salt",
      "Fresh coriander & mint leaves",
    ],
    steps: [
      "Marinate chicken with curd and spices for 30 minutes.",
      "Fry onions until golden brown.",
      "Add chicken and cook until tender.",
      "Add rice and water, then cook until rice is fluffy.",
      "Garnish with coriander and mint, serve hot!",
    ],
  },
  {
    name: "Paneer Butter Masala",
    keywords: ["paneer", "butter", "gravy"],
    ingredients: [
      "200g paneer cubes",
      "2 tomatoes",
      "1 onion",
      "1 tbsp butter",
      "Cream, garam masala, salt, chili powder",
    ],
    steps: [
      "Blend tomatoes and onions into puree.",
      "Fry in butter with spices.",
      "Add paneer cubes and cook for 5 minutes.",
      "Stir in cream and serve with roti or rice.",
    ],
  },
  {
    name: "Egg Fried Rice",
    keywords: ["egg", "rice", "snack", "fried"],
    ingredients: [
      "2 eggs",
      "2 cups cooked rice",
      "1 onion, chopped",
      "1 tbsp soy sauce",
      "Salt and pepper to taste",
    ],
    steps: [
      "Scramble eggs in a pan.",
      "Add onions and stir-fry.",
      "Mix in cooked rice and soy sauce.",
      "Season and serve hot.",
    ],
  },
  {
    name: "Veg Sandwich",
    keywords: ["snack", "sandwich", "veg"],
    ingredients: [
      "2 slices of bread",
      "1 small tomato, sliced",
      "1 cucumber, sliced",
      "1 cheese slice",
      "Butter and salt to taste",
    ],
    steps: [
      "Spread butter on bread.",
      "Layer vegetables and cheese.",
      "Grill or toast for 2–3 minutes.",
      "Cut and serve warm.",
    ],
  },
];

//  Fetch Meals from MealDB
async function getMealsFromAPI(keyword) {
  try {
    const res = await axios.get(
      `https://www.themealdb.com/api/json/v1/1/search.php?s=${keyword}`
    );
    return res.data.meals ? res.data.meals.slice(0, 5) : [];
  } catch (e) {
    console.error("MealDB error:", e.message);
    return [];
  }
}

//  Root route
app.get("/", (req, res) => {
  res.send("🍳 Smart Recipe Assistant backend running (LocalDB → MealDB → Gemini)");
});

//  Chat Route
app.post("/api/chat", async (req, res) => {
  try {
    let { prompt } = req.body;
    if (!prompt)
      return res.status(400).json({ error: "Missing 'prompt' in request body" });

    let msg = prompt.toLowerCase().trim();

    //  Step 0: Fuzzy correction
    const allKeywords = [
      "chicken",
      "paneer",
      "rice",
      "snack",
      "dessert",
      "biryani",
      "egg",
      "sandwich",
    ];

    const correctedWords = msg.split(" ").map((w) => {
      const match = stringSimilarity.findBestMatch(w, allKeywords).bestMatch;
      return match.rating > 0.5 ? match.target : w;
    });

    msg = correctedWords.join(" ");
    console.log("🔤 Corrected input:", msg);

    //  Step 1: LocalDB match
    const localMatch = localRecipes.filter((r) =>
      r.keywords.some((k) => msg.includes(k))
    );

    if (localMatch.length > 0) {
      console.log("✅ LocalDB Match Found!");
      const reply = localMatch
        .map(
          (r) => `🍽️ **${r.name}**

### 🧂 Ingredients
${r.ingredients.map((i) => `- ${i}`).join("\n")}

### 👨‍🍳 Steps
${r.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
        )
        .join("\n\n");
      return res.json({ reply });
    }

    //  Step 2: MealDB multi-keyword search
    let allMeals = [];
    for (const word of correctedWords) {
      const meals = await getMealsFromAPI(word);
      if (meals.length > 0) {
        allMeals.push(
          ...meals.map((m) => ({
            name: m.strMeal,
            thumb: m.strMealThumb,
          }))
        );
      }
    }

    // Remove duplicates
    allMeals = allMeals.filter(
      (v, i, a) => a.findIndex((t) => t.name === v.name) === i
    );

    if (allMeals.length > 0) {
      console.log("🍴 MealDB results found");
      const reply =
        "🍴 Here are some dishes based on your ingredients:\n\n" +
        allMeals
          .slice(0, 6)
          .map((m) => `🍽️ **${m.name}**\n![${m.name}](${m.thumb})`)
          .join("\n\n") +
        "\n\nWould you like the recipe for any of these?";
      return res.json({ reply });
    }

    // Step 3: Gemini fallback
    try {
      const aiRes = await axios.post(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          contents: [
            {
              parts: [
                {
                  text: `You are a recipe assistant. User said: "${prompt}". 
If it's a single word (like 'chicken'), suggest 3–5 related dishes. 
If it asks for "how to make" or "ingredients", return a clear, Markdown-formatted recipe.`,
                },
              ],
            },
          ],
        }
      );

      const aiText =
        aiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (aiText && !aiText.toLowerCase().includes("sorry")) {
        return res.json({ reply: aiText });
      }
    } catch (err) {
      console.error("Gemini failed:", err.message);
    }

    // Step 4: Default fallback
    return res.json({
      reply:
        "😕 Sorry, I couldn’t find that recipe. Try something like 'chicken', 'paneer', 'rice', or 'snacks'.",
    });
  } catch (err) {
    console.error("❌ Server Error:", err);
    res
      .status(500)
      .json({ error: err.message || "Failed to process the request" });
  }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
