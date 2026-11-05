const notFound = () => new Response("Not found", { status: 404 });

export const GET = notFound;
export const DELETE = notFound;
