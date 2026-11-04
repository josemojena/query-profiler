import { useEffect } from "react";
import { Link, useFetcher } from "react-router";
import { prisma } from "../db.server";
import type { Route } from "./+types/products";
import type { loader as offersLoader } from "./offers";
import type { loader as purchasesLoader } from "./purchases";

export async function loader() {
  return { products: await prisma.product.findMany({ orderBy: { id: "asc" } }) };
}

// The page loads the products; offers and purchases come after, from two fetchers.
export default function Products({ loaderData }: Route.ComponentProps) {
  const offers = useFetcher<typeof offersLoader>();
  const purchases = useFetcher<typeof purchasesLoader>();
  const buy = useFetcher();

  const { load: loadOffers } = offers;
  const { load: loadPurchases } = purchases;
  useEffect(() => {
    void loadOffers("/products/offers");
    void loadPurchases("/products/purchases");
  }, [loadOffers, loadPurchases]);

  return (
    <main className="grid gap-8 p-8">
      <Link to="/" className="underline">
        Users
      </Link>
      <section>
        <h1 className="mb-4 text-2xl font-bold">Products</h1>
        <ul>
          {loaderData.products.map((product) => (
            <li key={product.id} className="flex gap-4">
              {product.name}: {product.price} €
              <buy.Form method="post" action="/products/purchases">
                <input type="hidden" name="productId" value={product.id} />
                <button className="underline">Buy</button>
              </buy.Form>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-2 text-xl font-bold">Offers</h2>
        {offers.data?.map((offer) => (
          <p key={offer.id}>
            {offer.product.name}: −{offer.discount}%
          </p>
        )) ?? <p>Loading…</p>}
      </section>
      <section>
        <h2 className="mb-2 text-xl font-bold">Latest purchases</h2>
        {purchases.data?.map((purchase) => (
          <p key={purchase.id}>
            {purchase.product.name} × {purchase.quantity}
          </p>
        )) ?? <p>Loading…</p>}
      </section>
    </main>
  );
}
