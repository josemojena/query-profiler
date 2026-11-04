const notFound = () => new Response("Not found", { status: 404 });

export const loader = notFound;
export const action = notFound;
