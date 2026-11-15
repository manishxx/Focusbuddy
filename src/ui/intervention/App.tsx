import { format } from "../../core/messages";
import { PRODUCT_NAME } from "../shared/product";

export function App() {
  return (
    <main>
      <h1>{PRODUCT_NAME}</h1>
      <p>{format("intervention.closeHint")}</p>
    </main>
  );
}
