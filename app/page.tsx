import Head from "next/head";
// import { Inter } from "next/font/google";
import styles from "@/styles/Home.module.css";
import { SearchDialog } from "@/components/SearchDialog";
import Image from "next/image";
import Link from "next/link";
// const inter = Inter({ subsets: ["latin"] });

export default function Home() {
  return (
    <>
      <Head>
        <title>CIRA RubinOpenAI</title>
        <meta
          name="description"
          content="Next.js Template for building OpenAI applications with Supabase."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className={styles.main}>
        <div className={styles.center}>
          <SearchDialog />
        </div>

        <div className="py-8 w-full flex items-center justify-center space-x-6">
          <div className="opacity-75 transition hover:opacity-100 cursor-pointer">
            <Link
              href="https://astronomy.curtin.edu.au/"
              className="flex items-center justify-center"
            >
              <p className="text-base mr-2">Built by CIRA</p>
              <Image 
              src="https://global.curtin.edu.au/responsive-assets/img/logo-curtin-university.png" 
              alt="Curtin University logo"
              width={200}
              height={50}
              />
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
