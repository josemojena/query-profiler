import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("problems", "routes/problems.tsx"),
  route("products", "routes/products.tsx"),
  route("products/offers", "routes/offers.ts"),
  route("products/purchases", "routes/purchases.ts"),
] satisfies RouteConfig;
