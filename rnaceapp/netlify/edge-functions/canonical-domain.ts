export default async (request: Request, context: any) => {
  const url = new URL(request.url);

  if (url.hostname === 'centrornace.netlify.app' || url.hostname === 'www.centrornace.com') {
    url.hostname = 'centrornace.com';
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }

  return context.next();
};
