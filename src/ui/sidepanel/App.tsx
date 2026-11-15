import { PRODUCT_NAME } from "../shared/product";

// TODO(copy): no bank string fits a placeholder side panel; replace with the
// real panel on its feature day. Not shipped to users in this form.
const PLACEHOLDER_LINE = "Side panel placeholder (Day 05 scaffold).";

export function App() {
  return (
    <main>
      <h1>{PRODUCT_NAME}</h1>
      <p>{PLACEHOLDER_LINE}</p>
    </main>
  );
}
